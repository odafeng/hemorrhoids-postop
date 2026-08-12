// Supabase Edge Function: researcher-invite
// PI adds a researcher (or another PI) to the study team.
// Creates a confirmed auth.users row with role metadata and an initial password
// the PI hands over directly. No email is sent.
//
// This used to call inviteUserByEmail. That flow left the account holding a
// random password GoTrue showed nobody, so it depended on the emailed link
// working — and when the reset mail turned out to carry no usable link, the
// invitee had no way in at all. Handing the password over out-of-band removes
// mail delivery from the critical path; user_metadata.invited_at still forces
// the researcher to replace the PI's password on first login.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { invitationErrorResponse } from "./errors.ts";

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller is PI (only PI can invite new researchers)
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Read role from app_metadata (server-controlled); user_metadata.role
    // can be forged by the user themselves.
    const callerRole = user.app_metadata?.role;
    if (callerRole !== "pi") {
      return new Response(JSON.stringify({ error: "只有主持人（PI）可以邀請研究人員" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const email: string = (body.email || "").trim();
    const displayName: string = (body.display_name || "").trim();
    const role: string = body.role === "pi" ? "pi" : "researcher";
    const surgeonId: string | null = (body.surgeon_id || "").trim().toUpperCase() || null;
    const initialPassword: string = body.initial_password || "";

    const SURGEONS = ["HSF", "HCW", "WJH", "CPT", "WCC", "LMH", "CYH", "FIH"];

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: "Email 格式不正確" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!displayName) {
      return new Response(JSON.stringify({ error: "請輸入研究人員姓名" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (initialPassword.length < 8) {
      return new Response(JSON.stringify({ error: "初始密碼至少需要 8 個字元" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (role === "researcher" && !surgeonId) {
      return new Response(JSON.stringify({ error: "請指定研究人員所屬的主刀醫師" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (surgeonId && !SURGEONS.includes(surgeonId)) {
      return new Response(JSON.stringify({ error: `surgeon_id ${surgeonId} 不在允許清單` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Create the account outright. Only cosmetic / non-security fields go into
    // user_metadata here (display_name, invited_by). Security-critical
    // claims (role, surgeon_id) are written to app_metadata below via
    // updateUserById, which is NOT writable by the user themselves.
    //
    // email_confirm skips the confirmation mail: the PI vouched for this address
    // by typing it, and there is no link for the researcher to click anyway.
    //
    // invited_at is what makes the app demand a new password on first login —
    // the PI knows this one. supabaseService.updatePassword answers it with
    // password_set_at.
    //
    // NOTE: We do NOT pre-check for duplicate emails with listUsers() because
    // that API is paginated and a pre-check would silently miss users beyond
    // the first page. Instead we let createUser fail and translate the
    // "already registered" error into a proper 409 response.
    const { data, error: inviteError } = await adminClient.auth.admin.createUser({
      email,
      password: initialPassword,
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
        invited_by: user.id,
        invited_at: new Date().toISOString(),
      },
    });
    if (inviteError) {
      const translated = invitationErrorResponse(inviteError, email);
      if (translated) {
        return new Response(JSON.stringify({ error: translated.error }), {
          status: translated.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw inviteError;
    }

    // Set security-critical claims in app_metadata (server-controlled)
    if (data.user?.id) {
      const { error: appMetaErr } = await adminClient.auth.admin.updateUserById(
        data.user.id,
        { app_metadata: { role, surgeon_id: surgeonId } },
      );
      if (appMetaErr) {
        console.error("researcher-invite app_metadata error:", appMetaErr);
        return new Response(JSON.stringify({ error: "帳號已建立但權限設定失敗，請聯絡管理員" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Audit
    await adminClient.from("audit_trail").insert({
      actor_id: user.id,
      actor_role: callerRole,
      action: "admin.invite_researcher",
      resource: "auth.users",
      resource_id: data.user?.id || email,
      detail: { target_email: email, role, display_name: displayName, surgeon_id: surgeonId },
    });

    return new Response(JSON.stringify({
      success: true,
      user: { id: data.user?.id, email, role, display_name: displayName, surgeon_id: surgeonId },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("researcher-invite error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
