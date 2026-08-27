// Supabase Edge Function: close-followup
// Called by GitHub Actions cron. Marks a subject completed once follow-up ends.
//
// POD 30 ends the observation window but is not a report day, so nothing on the patient
// side marks it. See docs/adr/0001-followup-close-out-at-pod30.md.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { STUDY_STATUS } from "../_shared/followup.ts";
import { closeFollowUp } from "./close.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("Authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: JSON_HEADERS });
  }

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Taiwan time, matching check-adherence: UTC midnight–08:00 would be the wrong day.
    const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().split("T")[0];

    const result = await closeFollowUp(today, {
      // No status filter here — patientsToClose() owns that decision, and a filter
      // written twice is a filter that drifts.
      listPatients: async () => {
        const { data, error } = await adminClient
          .from("patients")
          .select("study_id, surgery_date, study_status");
        return { patients: data, error };
      },
      markCompleted: async (studyId: string, completedAt: string) => {
        const { error } = await adminClient
          .from("patients")
          .update({
            study_status: STUDY_STATUS.COMPLETED,
            completed_at: completedAt,
            updated_at: new Date().toISOString(),
          })
          .eq("study_id", studyId)
          .eq("study_status", STUDY_STATUS.ACTIVE); // lost-update guard
        return { error };
      },
    });

    return new Response(JSON.stringify({ today, ...result.body }), {
      status: result.status,
      headers: JSON_HEADERS,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: JSON_HEADERS });
  }
});
