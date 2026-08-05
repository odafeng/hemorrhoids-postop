// Supabase Edge Function: researcher-manage
// PI-only actions on researcher/PI user accounts:
//   action=list  → list all users with role in (researcher, pi)
//   action=ban   → disable user by setting ban_duration to 100 years
//   action=unban → re-enable user (ban_duration=none)
//   action=resend_activation → email a password setup link to an existing staff user

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { resendResearcherActivation } from "./actions.ts";

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

    // Verify caller = PI
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
    // Read role from app_metadata (user_metadata is user-writable and forgeable).
    if (user.app_metadata?.role !== "pi") {
      return new Response(JSON.stringify({ error: "只有主持人（PI）可以管理研究人員帳號" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const action: string = body.action;
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    if (action === "list") {
      // Paginate through all auth users so staff accounts beyond page 1 are
      // not silently omitted from the team list.
      let allUsers: { id: string; email?: string; user_metadata: Record<string, unknown>; app_metadata: Record<string, unknown>; created_at: string; last_sign_in_at?: string; [key: string]: unknown }[] = [];
      let page = 1;
      while (true) {
        const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000, page });
        if (error) throw error;
        allUsers = allUsers.concat(data.users as typeof allUsers);
        if (data.users.length < 1000) break;
        page++;
      }
      const researchers = allUsers
        .filter((u) => {
          // SECURITY: role lives in app_metadata (server-controlled).
          // Reading from user_metadata would (a) miss newly-invited
          // researchers whose role was only set in app_metadata, and
          // (b) surface self-declared roles from user_metadata.
          const r = u.app_metadata?.role;
          return r === "researcher" || r === "pi";
        })
        .map((u) => ({
          id: u.id,
          email: u.email,
          // display_name is cosmetic — user_metadata is fine here.
          display_name: u.user_metadata?.display_name || null,
          // role + surgeon_id come from server-controlled app_metadata.
          role: u.app_metadata?.role,
          surgeon_id: u.app_metadata?.surgeon_id || null,
          invited_at: u.user_metadata?.invited_at || null,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at || null,
          banned_until: (u as unknown as { banned_until?: string }).banned_until || null,
        }))
        .sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
      return new Response(JSON.stringify({ users: researchers }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "ban" || action === "unban") {
      const targetId: string = body.user_id;
      if (!targetId) {
        return new Response(JSON.stringify({ error: "缺少 user_id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Prevent PI from banning themselves
      if (targetId === user.id) {
        return new Response(JSON.stringify({ error: "不能停用自己的帳號" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify target is a staff (researcher/pi) account — block PIs from
      // accidentally (or maliciously) disabling patient logins via this endpoint.
      const { data: targetData, error: targetFetchErr } = await admin.auth.admin.getUserById(targetId);
      if (targetFetchErr || !targetData.user) {
        return new Response(JSON.stringify({ error: "找不到指定使用者" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const targetRole = targetData.user.app_metadata?.role;
      if (targetRole !== "researcher" && targetRole !== "pi") {
        return new Response(JSON.stringify({ error: "此操作僅限研究員或主持人帳號" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ~100 years = practically permanent; unban → 'none'
      // Supabase JS v2 accepts ban_duration on updateUserById
      const banDuration = action === "ban" ? "876000h" : "none";
      const { data, error } = await admin.auth.admin.updateUserById(targetId, {
        ban_duration: banDuration,
      } as unknown as Record<string, unknown>);
      if (error) throw error;

      await admin.from("audit_trail").insert({
        actor_id: user.id,
        actor_role: "pi",
        action: action === "ban" ? "admin.ban_user" : "admin.unban_user",
        resource: "auth.users",
        resource_id: targetId,
        detail: { target_email: data.user?.email },
      });

      return new Response(JSON.stringify({ success: true, action, user_id: targetId }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "resend_activation") {
      const result = await resendResearcherActivation(body.user_id, user.id, {
        getUserById: async (userId) => {
          const { data, error } = await admin.auth.admin.getUserById(userId);
          return { user: data.user, error };
        },
        sendRecoveryEmail: async (email) => {
          const { error } = await admin.auth.resetPasswordForEmail(email);
          return { error };
        },
        writeAudit: async (detail) => {
          await admin.from("audit_trail").insert({
            actor_id: detail.actor_id,
            actor_role: "pi",
            action: "admin.resend_researcher_activation",
            resource: "auth.users",
            resource_id: detail.target_id,
            detail: { target_email: detail.target_email },
          });
        },
      });
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("researcher-manage error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
