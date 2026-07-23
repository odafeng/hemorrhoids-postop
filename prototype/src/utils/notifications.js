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
// Scheduler
// =====================

let schedulerInterval = null;
let lastNotificationDate = null; // Track to avoid duplicate notifications per day

/**
 * Start the reminder scheduler
 * Checks every 15 minutes if it's past the reminder time and the user hasn't reported.
 *
 * @param {() => Promise<boolean>} checkReportedFn — async function returning true if today's report exists
 */
export function startReminderScheduler(checkReportedFn) {
  stopReminderScheduler();

  // Check immediately, then every 15 minutes
  const check = async () => {
    if (!isNotificationsEnabled()) return;
    if (getNotificationStatus() !== 'granted') return;

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
