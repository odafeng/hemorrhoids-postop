// Push Notification utility module
// Handles browser notification permissions, reminder scheduling, and SW-based notifications

const NOTIF_PREFS_KEY = 'notification_prefs';

// =====================
// Permission helpers
// =====================

/**
 * Check if the Notification API is supported
 */
export function isNotificationSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator;
}

/**
 * Get current notification permission status
 * @returns {'granted' | 'denied' | 'default' | 'unsupported'}
 */
export function getNotificationStatus() {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Request browser notification permission
 * @returns {Promise<'granted' | 'denied' | 'default'>}
 */
export async function requestPermission() {
  if (!isNotificationSupported()) return 'unsupported';
  const result = await Notification.requestPermission();
  return result;
}

// =====================
// Preferences (localStorage)
// =====================

function getPrefs() {
  try {
    const raw = localStorage.getItem(NOTIF_PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePrefs(prefs) {
  localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(prefs));
}

/**
 * Check if notifications are enabled by user preference
 */
export function isNotificationsEnabled() {
  return getPrefs().enabled === true;
}

/**
 * Set notifications enabled/disabled
 */
export function setNotificationsEnabled(enabled) {
  savePrefs({ ...getPrefs(), enabled });
}

/**
 * Get reminder time { hour, minute }
 * Defaults to 20:00
 */
export function getReminderTime() {
  const prefs = getPrefs();
  return {
    hour: prefs.hour ?? 20,
    minute: prefs.minute ?? 0,
  };
}

/**
 * Set reminder time
 */
export function setReminderTime(hour, minute) {
  savePrefs({ ...getPrefs(), hour, minute });
}

// =====================
// Notification display
// =====================

/**
 * Show a reminder notification via Service Worker
 */
/**
 * Show a reminder notification via Service Worker.
 * Returns { fired: boolean, reason?: string } so callers can surface UX feedback
 * when firing fails (previously silent-returned on permission denied).
 */
export async function showReminderNotification() {
  const status = getNotificationStatus();
  if (status === 'unsupported') return { fired: false, reason: 'unsupported' };
  if (status === 'denied')      return { fired: false, reason: 'denied' };
  if (status !== 'granted')     return { fired: false, reason: 'not-granted' };

  const opts = {
    body: '您今日尚未填寫症狀回報，請花 30 秒完成填寫。',
    // PNG, not SVG — Android Chrome cannot decode SVG notification icons and
    // falls back to a generic bell (see public/sw.js push handler).
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    tag: 'daily-reminder',      // deduplicate — only one at a time
    renotify: true,
    vibrate: [200, 100, 200],   // Android heads-up won't vibrate without explicit pattern
    data: { action: 'open-report' },
    actions: [
      { action: 'report',  title: '立即填寫' },
      { action: 'dismiss', title: '稍後' },
    ],
  };

  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('術後追蹤提醒 🏥', opts);
    return { fired: true };
  } catch (err) {
    // Fallback: direct Notification (no SW actions / vibrate support)
    console.warn('SW notification failed, using fallback:', err);
    try {
      new Notification('術後追蹤提醒 🏥', {
        body: opts.body,
        icon: opts.icon,
        tag: opts.tag,
      });
      return { fired: true, reason: 'fallback' };
    } catch {
      return { fired: false, reason: 'error' };
    }
  }
}

// =====================
// Report-day schedule
// =====================

/**
 * Is `day` one of the days the protocol asks for a symptom report?
 * 第一週每日、第二週每兩日一次、第三週起每週一次 → POD 0-7, 9/11/13, 20/27.
 *
 * This mirrors fn_report_days() (20260802160000_report_day_schedule.sql), which the
 * reminder cron reads over RPC precisely so the rule lives in one place. It is copied
 * here rather than fetched because that function is GRANTed to service_role only, and
 * opening it to patient roles means a production schema change — not something to do
 * mid-enrolment. The duplication is pinned by a test that lists all 13 days.
 *
 * @param {number|null} day — SIGNED offset from surgery. Pass getDaysFromSurgery(),
 *   not getPODFromDate(): the latter clamps pre-operative days to 0, which would make
 *   a patient enrolled before surgery look like they owe a POD 0 report.
 */
export function isReportDay(day) {
  if (typeof day !== 'number' || day < 0 || day > 30) return false;
  if (day <= 7) return true;
  if (day <= 14) return (day - 7) % 2 === 0;
  return (day - 13) % 7 === 0;
}

// =====================
// Scheduler
// =====================

let schedulerInterval = null;
let lastNotificationDate = null; // Track to avoid duplicate notifications per day

/**
 * Start the reminder scheduler
 * Checks every 15 minutes if it's past the reminder time and the user hasn't reported.
 *
 * @param {() => Promise<boolean>} checkReportedFn — async function returning true if today's report exists
 * @param {() => number|null} getDayFromSurgeryFn — signed days since surgery, or null
 *   if unknown. Called on every tick rather than captured once, so crossing midnight
 *   moves the scheduler onto the new day's schedule without a restart.
 */
export function startReminderScheduler(checkReportedFn, getDayFromSurgeryFn) {
  stopReminderScheduler();

  // Check immediately, then every 15 minutes
  const check = async () => {
    if (!isNotificationsEnabled()) return;
    if (getNotificationStatus() !== 'granted') return;
    // Silence on days the protocol never asks about — matches what check-adherence
    // does server-side. Unknown POD stays silent rather than guessing.
    if (!isReportDay(getDayFromSurgeryFn?.())) return;

    const now = new Date();
    const today = now.toLocaleDateString('en-CA');

    // Already sent notification today
    if (lastNotificationDate === today) return;

    const { hour, minute } = getReminderTime();
    const reminderMinutes = hour * 60 + minute;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    // Not yet time
    if (nowMinutes < reminderMinutes) return;

    // Check if already reported
    try {
      const reported = await checkReportedFn();
      if (reported) {
        lastNotificationDate = today; // Don't remind again today
        return;
      }
    } catch {
      return; // Don't send notification on error
    }

    // Fire notification
    lastNotificationDate = today;
    showReminderNotification();
  };

  check(); // Immediate check
  schedulerInterval = setInterval(check, 15 * 60 * 1000); // Every 15 min
}

/**
 * Stop the reminder scheduler
 */
export function stopReminderScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  lastNotificationDate = null;
}
