// Applying the close-out rule. The rule lives in _shared/followup.ts; this file only
// turns its plans into writes and reports what happened. Given its deps rather than a
// client so the whole path — the partial-failure branch included — is testable without
// a database, following researcher-manage/actions.ts.

import { type ClosablePatient, patientsToClose } from "../_shared/followup.ts";

type DbError = { message?: string } | null;

export type CloseFollowUpDeps = {
  /** Every non-withdrawn row; patientsToClose() decides which ones matter. */
  listPatients: () => Promise<{ patients: ClosablePatient[] | null; error: DbError }>;
  markCompleted: (studyId: string, completedAt: string) => Promise<{ error: DbError }>;
};

type ClosedRow = { study_id: string; pod: number; completed_at: string };
type FailedRow = { study_id: string; error: string };

export type CloseResult = {
  status: number;
  body: { closed?: ClosedRow[]; failed?: FailedRow[]; error?: string };
};

/** Taiwan is UTC+8 year-round, so the endpoint date needs no DST handling. */
export function completedAtFor(completedOn: string): string {
  return `${completedOn}T00:00:00+08:00`;
}

/**
 * Close every row whose follow-up has ended, as of `today` (YYYY-MM-DD).
 *
 * Re-running is a no-op: patientsToClose() skips rows that are no longer active.
 * A row that fails to update does not stop the others, but any failure returns 500
 * so the cron surfaces it instead of reporting a quiet success.
 */
export async function closeFollowUp(
  today: string,
  deps: CloseFollowUpDeps,
): Promise<CloseResult> {
  const { patients, error } = await deps.listPatients();
  if (error || !patients) {
    return { status: 500, body: { error: error?.message ?? "無法讀取 patients" } };
  }

  const closed: ClosedRow[] = [];
  const failed: FailedRow[] = [];

  for (const plan of patientsToClose(patients, today)) {
    const completedAt = completedAtFor(plan.completed_on);
    const { error: writeError } = await deps.markCompleted(plan.study_id, completedAt);
    if (writeError) {
      failed.push({ study_id: plan.study_id, error: writeError.message ?? "unknown" });
      continue;
    }
    closed.push({ study_id: plan.study_id, pod: plan.pod, completed_at: completedAt });
  }

  return { status: failed.length ? 500 : 200, body: { closed, failed } };
}
