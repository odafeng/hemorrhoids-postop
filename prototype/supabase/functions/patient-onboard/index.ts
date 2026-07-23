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

    // Parse the body up front: the existing-patient branch below needs the
    // invite token too. Onboarding is not atomic (patient row, app_metadata
    // promote and invite claim are three separate writes), so a retry can
    // legitimately arrive with a valid token AND an existing patient row.
    let body: { invite_token?: string } = {};
    try {
      body = await req.json();
    } catch {
      // empty body is ok for backwards compat, but token will be required
    }
    const inviteToken = body.invite_token;

    // Promote role / study_id / surgeon_id into app_metadata — the trusted
    // claim source every RLS helper reads. supabase-js admin methods resolve
    // with { error } instead of rejecting, so this MUST be checked: swallowing
    // it returns 200 to a client that then burns its one-shot invite token and
    // is left with a JWT that fails every RLS check, permanently.
    const promoteClaims = async (surgeonId: string | null) => {
      const { error } = await adminClient.auth.admin.updateUserById(user.id, {
        app_metadata: { ...(user.app_metadata || {}), role, study_id: studyId, surgeon_id: surgeonId },
      });
      return error;
    };

    const claimsFailed = () => new Response(
      JSON.stringify({ error: "帳號已建立但權限設定失敗，請重試或聯絡研究團隊。" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

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
        if (needsPromote && await promoteClaims(existingSurgeonId)) return claimsFailed();
      } else {
        // No ownership recorded yet. Two very different situations:
        //
        //  (a) A RETRY. Onboarding is three non-atomic writes (patient row →
        //      claim invite → promote claims). If it died partway, the row
        //      exists while study_invites is still unclaimed, and the client
        //      correctly kept its invite token. Presenting a valid, unexpired,
        //      still-unclaimed token for THIS study_id is proof of ownership —
        //      it is the same secret the researcher handed to this patient.
        //      Refusing here would strand exactly the patient this whole
        //      retry path exists to rescue.
        //
        //  (b) A DUPLICATE study_id. The client-side uniqueness check cannot
        //      see other patients' rows through RLS, so it always reports
        //      "free" and a collision only surfaces here. No valid unclaimed
        //      invite → refuse.
        //
        // Returning 200 + the row (the previous behaviour) was wrong for both:
        // it leaked another patient's record to anyone who guessed a study_id,
        // and told the client "onboarded" while app_metadata stayed unset.
        const { data: unclaimed } = inviteToken
          ? await adminClient
            .from("study_invites")
            .select("id")
            .eq("invite_token", inviteToken)
            .eq("study_id", studyId)
            .is("used_by_user_id", null)
            .gte("expires_at", new Date().toISOString())
            .maybeSingle()
          : { data: null };

        if (!unclaimed) {
          console.warn("[patient-onboard] existing patient, no ownership proof and no valid unclaimed invite; refusing", { study_id: studyId, user_id: user.id });
          return new Response(
            JSON.stringify({ error: `研究編號 ${studyId} 已被其他帳號使用，請聯絡研究團隊確認編號。` }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // Claim BEFORE promoting, so a promote failure still leaves proof of
        // ownership behind and the next retry takes the ownedInvite path.
        //
        // `.is("used_by_user_id", null)` + checking a row came back makes this
        // a compare-and-set. Unlike the new-patient path there is no UNIQUE
        // insert serialising callers here, so without the row check two
        // requests racing on one token would both continue and the loser would
        // be granted claims for a study_id it does not own — PostgREST reports
        // "matched nothing" as success, not as an error.
        const { data: claimed, error: claimErr } = await adminClient
          .from("study_invites")
          .update({ status: "used", used_by_user_id: user.id, used_at: new Date().toISOString() })
          .eq("id", unclaimed.id)
          .is("used_by_user_id", null)
          .select("id")
          .maybeSingle();
        if (claimErr || !claimed) {
          console.error("invite claim error:", claimErr, { study_id: studyId });
          return new Response(
            JSON.stringify({ error: `研究編號 ${studyId} 已被其他帳號使用，請聯絡研究團隊確認編號。` }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        if (await promoteClaims(existingSurgeonId)) return claimsFailed();
      }
      return new Response(JSON.stringify({ patient: existing }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Invite token validation (new patients only) ---
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

    // Claim the invite BEFORE promoting. These are separate writes and the
    // function can die between them; whichever runs first decides what a retry
    // can prove. Claiming first records ownership (used_by_user_id), so a
    // failed promote still leaves the retry a way back in via the
    // existing-patient ownedInvite path. Promoting first would leave the invite
    // unclaimed and the patient row present — indistinguishable from someone
    // squatting another patient's study_id.
    //
    // `.is("used_by_user_id", null)` makes the claim a compare-and-set: two
    // concurrent registrations racing on the same token cannot both win.
    const { data: claimed, error: claimError } = await adminClient
      .from("study_invites")
      .update({
        status: "used",
        used_by_user_id: user.id,
        used_at: new Date().toISOString(),
      })
      .eq("id", invite.id)
      .is("used_by_user_id", null)
      .select("id")
      .maybeSingle();

    if (claimError || !claimed) {
      console.error("invite claim error:", claimError, { study_id: studyId });
      return new Response(
        JSON.stringify({ error: "邀請碼已被使用，請聯絡研究團隊。" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // SECURITY: promote role / study_id / surgeon_id to app_metadata so RLS
    // helpers (which read app_metadata) can't be bypassed.
    const promoteErr = await promoteClaims(surgeonId);
    if (promoteErr) {
      console.error("app_metadata promote error:", promoteErr);
      return claimsFailed();
    }

    // Audit trail: patient onboarding. Best-effort — onboarding has already
    // succeeded and must not be failed over a missing log line — but the error
    // is surfaced, not discarded: audit-trail completeness is an IRB-auditable
    // property, and PostgREST reports failures via { error } rather than
    // throwing, so an unchecked await here would be 100% silent.
    const { error: auditError } = await adminClient.from("audit_trail").insert({
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
    if (auditError) {
      console.error("[patient-onboard] AUDIT WRITE FAILED", { study_id: studyId, user_id: user.id, error: auditError });
    }

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
