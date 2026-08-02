// Supabase Edge Function: check-adherence
// Called by GitHub Actions cron to check daily symptom report adherence
// Creates pending_notifications AND sends Web Push to subscribed patients

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendPushToMany } from "../_shared/web-push.ts";
import { patientsDueForReminder } from "./schedule.ts";

Deno.serve(async (req: Request) => {
  // Only allow POST with a secret key (from GitHub Actions)
  const cronSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("Authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    // VAPID config
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:noreply@example.com";
    const pushEnabled = vapidPublicKey && vapidPrivateKey;

    // Get all active patients
    const { data: patients, error: patientsError } = await adminClient
      .from("patients")
      .select("study_id, surgery_date")
      .eq("study_status", "active");

    if (patientsError) throw patientsError;

    // Use Taiwan time (UTC+8) for date calculations
    // Critical: UTC midnight–08:00 would be wrong day in Taiwan
    const taiwanNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const today = taiwanNow.toISOString().split("T")[0];
    let reminded = 0;
    let pushed = 0;
    let pushFailed = 0;
    const expiredEndpoints: string[] = [];

    // The consented schedule (第一週每日、第二週每兩日一次、第三週起每週一次) lives in
    // fn_report_days(); fetching it keeps this function from carrying a second copy.
    // Throw rather than default to every-day or no-day: silently reminding on the wrong
    // days is what this change exists to stop, and silently reminding nobody would
    // disable the follow-up nudge without anything surfacing it.
    const { data: reportDayRows, error: reportDaysError } = await adminClient
      .rpc("fn_report_days");
    if (reportDaysError) throw reportDaysError;
    const reportDays = new Set<number>((reportDayRows ?? []).map(Number));
    if (reportDays.size === 0) throw new Error("fn_report_days() returned no report days");

    const due = patientsDueForReminder(patients || [], today, reportDays);
    // Everyone not due today is skipped before any per-patient query runs.
    let skipped = (patients?.length ?? 0) - due.length;

    for (const patient of due) {
      // Check if patient reported today
      const { data: report } = await adminClient
        .from("symptom_reports")
        .select("id")
        .eq("study_id", patient.study_id)
        .eq("report_date", today)
        .single();

      if (report) {
        skipped++;
        continue; // Already reported
      }

      // Check if we already sent a notification today (Taiwan time)
      const { data: existing } = await adminClient
        .from("pending_notifications")
        .select("id")
        .eq("study_id", patient.study_id)
        .eq("type", "reminder")
        .gte("created_at", `${today}T00:00:00+08:00`)
        .single();

      if (existing) {
        skipped++;
        continue; // Already notified
      }

      const pod = patient.pod;
      const title = "術後追蹤提醒 🏥";
      const podLabel = pod === 0 ? "手術當日" : `POD ${pod}`;
      const message = `您今天（${podLabel}）尚未填寫症狀回報，請花 30 秒完成填寫。`;

      // Create pending notification (always, even if push fails)
      await adminClient.from("pending_notifications").insert({
        study_id: patient.study_id,
        type: "reminder",
        title: `📋 ${title}`,
        message,
      });
      reminded++;

      // Send Web Push if VAPID is configured
      if (pushEnabled) {
        const { data: subscriptions } = await adminClient
          .from("push_subscriptions")
          .select("endpoint, keys_p256dh, keys_auth")
          .eq("study_id", patient.study_id);

        if (subscriptions && subscriptions.length > 0) {
          const payload = { title, body: message, tag: "daily-reminder" };
          const { results, expired } = await sendPushToMany(
            subscriptions,
            payload,
            vapidPublicKey,
            vapidPrivateKey,
            vapidSubject,
          );

          pushed += results.filter((r) => r.success).length;
          pushFailed += results.filter((r) => !r.success).length;
          expiredEndpoints.push(...expired);
        }
      }
    }

    // Clean up expired subscriptions
    if (expiredEndpoints.length > 0) {
      for (const endpoint of expiredEndpoints) {
        await adminClient
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", endpoint);
      }
    }

    // Log to audit trail
    await adminClient.from("audit_trail").insert({
      actor_role: "system",
      action: "cron.check_adherence",
      resource: "pending_notifications",
      detail: {
        date: today,
        reminded,
        pushed,
        push_failed: pushFailed,
        expired_cleaned: expiredEndpoints.length,
        skipped,
        total: patients?.length || 0,
        push_enabled: pushEnabled,
      },
    });

    return new Response(
      JSON.stringify({
        date: today,
        reminded,
        pushed,
        push_failed: pushFailed,
        skipped,
        total: patients?.length,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("check-adherence error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
