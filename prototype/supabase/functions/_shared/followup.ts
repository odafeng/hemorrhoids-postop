// When a subject's follow-up ends, and what that means for the row.
//
// POD 30 closes the observation window but it is not a report day — fn_report_days()
// stops at 27 — so no push, card or cron speaks up on that day. Nothing in the codebase
// ever wrote study_status to anything but 'active' either (patient-onboard sets it once),
// which is how HSF-001 sat five days past its endpoint with nobody noticing. Closing has
// to be driven server-side, and this module is the only place the rule is written.
//
// podFor() moved here from check-adherence/schedule.ts once a second consumer appeared;
// that file now imports it rather than keeping a copy.

export const FOLLOWUP_DAYS = 30;

export const STUDY_STATUS = {
  ACTIVE: "active",
  COMPLETED: "completed",
  WITHDRAWN: "withdrawn",
} as const;

export interface ClosablePatient {
  study_id: string;
  surgery_date: string | null;
  study_status: string;
}

export interface ClosePlan {
  study_id: string;
  pod: number;
  /** The day follow-up ended (YYYY-MM-DD) — never the moment the closer happened to run. */
  completed_on: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
};

/** Post-operative day for `today`, both dates as YYYY-MM-DD. */
export function podFor(surgeryDate: string, today: string): number {
  const surgery = Date.parse(`${surgeryDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  return Math.floor((now - surgery) / DAY_MS);
}

/** The date follow-up ends for a given surgery date, YYYY-MM-DD. */
export function followUpEndsOn(surgeryDate: string): string {
  return addDays(surgeryDate, FOLLOWUP_DAYS);
}

/**
 * Which rows are due to be closed as of `today`, and what to stamp on them.
 *
 * Anything already completed or withdrawn is left alone, so re-running is a no-op.
 * TEST- rows are skipped: CI re-seeds that account and closing it would fight the
 * E2E fixture for no benefit.
 */
export function patientsToClose(
  patients: readonly ClosablePatient[],
  today: string,
): ClosePlan[] {
  const plans: ClosePlan[] = [];
  for (const p of patients) {
    if (!p.surgery_date) continue;
    if (p.study_status !== STUDY_STATUS.ACTIVE) continue;
    if (p.study_id.startsWith("TEST-")) continue;
    const pod = podFor(p.surgery_date, today);
    if (pod < FOLLOWUP_DAYS) continue;
    plans.push({
      study_id: p.study_id,
      pod,
      completed_on: followUpEndsOn(p.surgery_date),
    });
  }
  return plans;
}
