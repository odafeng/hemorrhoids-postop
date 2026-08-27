// Which patients are due for a symptom-report reminder today.
//
// Split out of index.ts so the decision is testable without a database, and kept free
// of the schedule itself: `reportDays` is fetched from fn_report_days() at runtime, so
// the protocol lives in exactly one place. Before this, the cron reminded every patient
// every day from POD 0 to 30, which contradicted the schedule the subject consented to
// (第一週每日、第二週每兩日一次、第三週起每週一次) and nagged them on days they were
// never asked to report.

import { podFor } from "../_shared/followup.ts";

export interface PatientRow {
  study_id: string;
  surgery_date: string;
}

export interface DuePatient {
  study_id: string;
  pod: number;
}

export function patientsDueForReminder(
  patients: readonly PatientRow[],
  today: string,
  reportDays: ReadonlySet<number>,
): DuePatient[] {
  const due: DuePatient[] = [];
  for (const p of patients) {
    if (!p.surgery_date) continue;
    const pod = podFor(p.surgery_date, today);
    // reportDays only ever contains 0–30, so this also bounds the observation window.
    if (!reportDays.has(pod)) continue;
    due.push({ study_id: p.study_id, pod });
  }
  return due;
}
