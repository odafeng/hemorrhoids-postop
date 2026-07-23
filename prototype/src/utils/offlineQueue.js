// Offline queue for symptom reports
// Stores failed submissions in localStorage and retries when back online

const QUEUE_KEY = 'offline_report_queue';

export function enqueueReport(studyId, pod, report, reportDate) {
  const queue = getQueuedReports();
  queue.push({
    studyId,
    pod,
    report,
    reportDate: reportDate || null,
    queuedAt: new Date().toISOString(),
    id: crypto.randomUUID(),
  });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function getQueuedReports() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function removeFromQueue(id) {
  const queue = getQueuedReports().filter(r => r.id !== id);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function getQueueCount() {
  return getQueuedReports().length;
}

/**
 * Flush all queued reports — call when back online.
 *
 * The patient was already shown a success tick when the report was queued, so
 * a permanently failing item is a report they believe was submitted and which
 * will never reach the database — no alert fires, no adherence credit, nothing
 * for the PI to review. The caller MUST surface `failed`/`errors`; returning
 * only `flushed` is how that stayed invisible.
 *
 * @param {Function} saveReportFn - (studyId, pod, report, reportDate?) => Promise
 * @returns {Promise<{ flushed: number, failed: number, errors: Array }>}
 */
export async function flushQueue(saveReportFn) {
  const queue = getQueuedReports();
  if (queue.length === 0) return { flushed: 0, failed: 0, errors: [] };

  let flushed = 0;
  let failed = 0;
  const errors = [];

  for (const item of queue) {
    try {
      if (item.reportDate) {
        await saveReportFn(item.studyId, item.pod, item.report, item.reportDate);
      } else {
        await saveReportFn(item.studyId, item.pod, item.report);
      }
      flushed++;
    } catch (e) {
      failed++;
      errors.push({
        id: item.id,
        studyId: item.studyId,
        reportDate: item.reportDate,
        pod: item.pod,
        attempts: (item.attempts || 0) + 1,
        message: e?.message || String(e),
      });
      // Keep the item queued so a later retry can still deliver it, but record
      // the attempt so a permanently stuck report is diagnosable.
      updateQueuedItem(item.id, {
        attempts: (item.attempts || 0) + 1,
        lastError: e?.message || String(e),
        lastAttemptAt: new Date().toISOString(),
      });
      continue;
    }
    // Only drop the item once the save actually returned. Removing inside the
    // try meant a localStorage quota error during removal counted the delivered
    // report as failed.
    removeFromQueue(item.id);
  }

  return { flushed, failed, errors };
}

/** Merge fields into a queued item, preserving queue order. */
function updateQueuedItem(id, patch) {
  const queue = getQueuedReports().map(r => (r.id === id ? { ...r, ...patch } : r));
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/** Drop every queued report — call on logout so items never flush under another account. */
export function clearQueue() {
  localStorage.removeItem(QUEUE_KEY);
}
