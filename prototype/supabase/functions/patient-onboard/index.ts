// Supabase Edge Function: patient-onboard
// Creates patient record on first login (replaces client-side ensurePatient)
// Uses service_role key so RLS doesn't block the insert

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

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
    // Verify the caller's JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create Supabase client with the user's JWT to verify identity
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get the authenticated user
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const studyId = user.user_metadata?.study_id;
    const surgeryDate = user.user_metadata?.surgery_date;
    // SECURITY: this Edge Function only onboards PATIENTS. Ignore any role
    // the client tried to set in user_metadata — always force 'patient'
    // when promoting to app_metadata. Researchers/PIs are onboarded via
    // researcher-invite (PI-only).
    const role = "patient";

    if (!studyId) {
      return new Response(JSON.stringify({ error: "No study_id in user metadata" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service_role client to bypass RLS for patient insert
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check if patient already exists (skip token check for existing patients)
    const { data: existing } = await adminClient
      .from("patients")
      .select("*")
      .eq("study_id", studyId)
      .single();

    if (existing) {
      // Defensive re-sync of app_metadata (for returning users whose
      // patient row was created before the secure-claims migration).
      // SECURITY: user_metadata.study_id is user-writable — a caller
      // could set another patient's study_id there and ride the sync
      // to get app_metadata claims for that victim cohort. Only promote
      // when we can PROVE the auth user owns this study_id by
      // matching study_invites.used_by_user_id (server-controlled).
      const existingSurgeonId = existing.surgeon_id
        || (studyId.includes("-") ? studyId.split("-")[0].toUpperCase() : null);
      const { data: ownedInvite } = await adminClient
        .from("study_invites")
        .select("id")
        .eq("study_id", studyId)
        .eq("used_by_user_id", user.id)
        .maybeSingle();

      if (ownedInvite) {
        const needsPromote = !user.app_metadata?.role
          || !user.app_metadata?.study_id
          || (existingSurgeonId && !user.app_metadata?.surgeon_id);
        if (needsPromote) {
          await adminClient.auth.admin.updateUserById(user.id, {
            app_metadata: {
              ...(user.app_metadata || {}),
              role,
              study_id: studyId,
              surgeon_id: existingSurgeonId,
            },
          }).catch((e) => console.error("app_metadata sync error:", e));
        }
      } else {
        // No proof of ownership — do NOT trust user_metadata. The existing
        // patient row exists but this caller didn't claim the invite for
        // it (or invite record is missing). Skip the promote; if the user
        // legitimately owns this record but has no invite trail, PI must
        // manually set app_metadata via the admin dashboard.
        console.warn("[patient-onboard] existing patient without invite ownership proof; skipping app_metadata sync", { study_id: studyId, user_id: user.id });
      }
      return new Response(JSON.stringify({ patient: existing }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Invite token validation (new patients only) ---
    // Two-tier: per-patient token (study_invites table) OR global token (env var)
    let body: { invite_token?: string } = {};
    try {
      body = await req.json();
    } catch {
      // empty body is ok for backwards compat, but token will be required
    }

    const inviteToken = body.invite_token;
    if (!inviteToken) {
      return new Response(JSON.stringify({ error: "invite_token is required for new patient registration" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate per-patient invite token from study_invites table
    const { data: invite } = await adminClient
      .from("study_invites")
      .select("*")
      .eq("invite_token", inviteToken)
      .eq("study_id", studyId)
      .eq("status", "pending")
      .gte("expires_at", new Date().toISOString())
      .maybeSingle();

    if (!invite) {
      console.error("Invite validation failed:", { studyId, inviteToken: "[redacted]" });
      return new Response(JSON.stringify({ error: "Invalid or expired invite token" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse surgeon prefix from study_id (e.g. "HSF-001" → "HSF")
    const surgeonId = studyId.includes("-") ? studyId.split("-")[0].toUpperCase() : null;

    // Create new patient record
    const { data: patient, error: insertError } = await adminClient
      .from("patients")
      .insert({
        study_id: studyId,
        surgery_date: surgeryDate || new Date().toISOString().split("T")[0],
        study_status: "active",
        surgeon_id: surgeonId,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Patient insert error:", insertError);
      return new Response(JSON.stringify({ error: "Failed to create patient" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SECURITY: promote role / study_id / surgeon_id to app_metadata so RLS
    // helpers (which read app_metadata) can't be bypassed. This MUST succeed
    // before we consume the invite token — if it fails, return an error so
    // the user can retry (the patient row is already created and idempotent;
    // the next attempt will go through the existing-patient resync path).
    const { error: promoteErr } = await adminClient.auth.admin.updateUserById(user.id, {
      app_metadata: {
        ...(user.app_metadata || {}),
        role,
        study_id: studyId,
        surgeon_id: surgeonId,
      },
    });
    if (promoteErr) {
      console.error("app_metadata promote error:", promoteErr);
      return new Response(
        JSON.stringify({ error: "帳號已建立但權限設定失敗，請重新登入或聯絡管理員" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Mark per-patient invite token as used
    await adminClient
      .from("study_invites")
      .update({
        status: "used",
        used_by_user_id: user.id,
        used_at: new Date().toISOString(),
      })
      .eq("id", invite.id);

    // Audit trail: patient onboarding
    await adminClient.from("audit_trail").insert({
      actor_id: user.id,
      actor_role: "patient",
      action: "patient.onboard",
      resource: "patients",
      resource_id: studyId,
      detail: {
        surgery_date: patient.surgery_date,
        invite_id: invite.id,
      },
    });

    return new Response(JSON.stringify({ patient }), {
      status: 201,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("patient-onboard error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
