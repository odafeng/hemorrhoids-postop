// =====================
// Follow-up close-out
// =====================
//
// Mirrors supabase/functions/_shared/followup.ts, which the close-followup cron applies.
// Copied rather than imported because that module is Deno and this bundle is Vite; the
// duplication is pinned by a test that reads the TypeScript file and compares. Same
// arrangement as isReportDay() mirroring fn_report_days().
//
// POD is deliberately NOT recomputed here — use getPODFromDate() from supabaseService.

export const FOLLOWUP_DAYS = 30;

export const STUDY_STATUS = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  WITHDRAWN: 'withdrawn',
};

/** How many days before the endpoint the countdown starts showing. UI-only. */
export const CLOSE_WARNING_DAYS = 7;

/** The date follow-up ends for a given surgery date, YYYY-MM-DD. */
export function followUpEndsOn(surgeryDate) {
  if (!surgeryDate) return null;
  const d = new Date(`${String(surgeryDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + FOLLOWUP_DAYS);
  return d.toISOString().slice(0, 10);
}

/**
 * Where a subject sits relative to the end of follow-up.
 *
 * `overdue` should be rare once the cron runs — it means the endpoint passed and the
 * row is still active, which is the state HSF-001 sat in for five days unnoticed. It
 * stays in the UI rather than being treated as impossible: if the cron stops, this is
 * the only place a human would see it.
 *
 * @returns {{kind: 'withdrawn'|'closed'|'overdue'|'due'|'closing'|'active',
 *            daysLeft: number|null, endsOn: string|null}}
 */
export function closeOutState(studyStatus, pod, surgeryDate) {
  const endsOn = followUpEndsOn(surgeryDate);
  const at = (kind, daysLeft = null) => ({ kind, daysLeft, endsOn });

  if (studyStatus === STUDY_STATUS.WITHDRAWN) return at('withdrawn');
  if (studyStatus === STUDY_STATUS.COMPLETED) return at('closed');
  if (typeof pod !== 'number' || Number.isNaN(pod)) return at('active');

  const daysLeft = FOLLOWUP_DAYS - pod;
  if (daysLeft < 0) return at('overdue', daysLeft);
  if (daysLeft === 0) return at('due', 0);
  if (daysLeft <= CLOSE_WARNING_DAYS) return at('closing', daysLeft);
  return at('active', daysLeft);
}

/**
 * How a close-out state reads in the cohort list. `null` means show nothing —
 * a subject in the middle of follow-up is the unremarkable case and does not
 * need a badge competing with the alert and adherence chips beside it.
 *
 * `tone` is a CSS custom-property name that index.css already defines.
 *
 * @returns {{text: string, tone: string}|null}
 */
export function closeOutBadge(state) {
  switch (state?.kind) {
    case 'closing': return { text: `結案剩 ${state.daysLeft} 天`, tone: 'warn' };
    case 'due': return { text: '今天到期', tone: 'warn' };
    case 'overdue': return { text: `逾期 ${-state.daysLeft} 天未結案`, tone: 'danger' };
    case 'closed': return { text: '已結案', tone: 'ok' };
    case 'withdrawn': return { text: '已退出', tone: 'ink-3' };
    default: return null;
  }
}
