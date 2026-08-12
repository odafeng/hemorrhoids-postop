import { useState, useEffect, useRef } from 'react';
import {
  isNotificationSupported,
  getNotificationStatus,
  requestPermission,
  isNotificationsEnabled,
  setNotificationsEnabled,
  getReminderTime,
  setReminderTime,
} from '../utils/notifications';
import * as sb from '../utils/supabaseService';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

// Convert URL-safe base64 to Uint8Array for PushManager
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from(rawData, (c) => c.charCodeAt(0));
}

export default function NotificationSetup({ studyId, isDemo }) {
  const [permission, setPermission] = useState(() => getNotificationStatus());
  const [enabled, setEnabled] = useState(isNotificationsEnabled());
  const [time, setTime] = useState(getReminderTime());
  const [justEnabled, setJustEnabled] = useState(false);
  const [pushStatus, setPushStatus] = useState(''); // '', 'subscribing', 'subscribed', 'error'
  const [testStatus, setTestStatus] = useState(''); // '' | 'sending' | 'cooldown' | 'fired' | 'failed' | 'denied' | 'no-sub' | 'demo'
  // Synchronous guard — React state updates are async so testStatus alone
  // doesn't protect against a tap landing during the same event loop tick.
  const testInFlightRef = useRef(false);

  // On mount: load server prefs + check existing push subscription
  useEffect(() => {
    if (!isDemo && studyId) {
      sb.getNotifPrefs(studyId).then(prefs => {
        if (prefs) {
          setEnabled(prefs.enabled);
          setTime({ hour: prefs.hour, minute: prefs.minute });
          setNotificationsEnabled(prefs.enabled);
          setReminderTime(prefs.hour, prefs.minute);
        }
      });
      // Async — setPushStatus is called from awaited callback, not synchronously
      navigator.serviceWorker?.ready
        .then(reg => reg?.pushManager?.getSubscription())
        .then(sub => setPushStatus(sub ? 'subscribed' : ''))
        .catch(() => {});
    }
  }, [studyId, isDemo]);

  const syncToServer = (newEnabled, newHour, newMinute) => {
    if (!isDemo && studyId) {
      sb.upsertNotifPrefs(studyId, {
        enabled: newEnabled,
        hour: newHour,
        minute: newMinute,
      });
    }
  };

  const subscribeToPush = async () => {
    if (!VAPID_PUBLIC_KEY || isDemo || !studyId) return false;
    try {
      setPushStatus('subscribing');
      const reg = await navigator.serviceWorker.ready;

      // Unsubscribe existing if any
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      await sb.savePushSubscription(studyId, subscription);
      setPushStatus('subscribed');
      console.info('[Push] Subscribed successfully');
      return true;
    } catch (e) {
      console.error('[Push] Subscribe failed:', e);
      setPushStatus('error');
      return false;
    }
  };

  const unsubscribeFromPush = async () => {
    try {
      const reg = await navigator.serviceWorker?.ready;
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        if (studyId) await sb.removePushSubscription(studyId, endpoint);
      }
      setPushStatus('');
    } catch (e) {
      console.error('[Push] Unsubscribe failed:', e);
    }
  };

  const supported = isNotificationSupported();

  const handleToggle = async () => {
    if (!enabled) {
      if (permission !== 'granted') {
        const result = await requestPermission();
        setPermission(result);
        if (result !== 'granted') return;
      }
      setNotificationsEnabled(true);
      setEnabled(true);
      setJustEnabled(true);
      syncToServer(true, time.hour, time.minute);

      // Subscribe to Web Push
      await subscribeToPush();

      setTimeout(() => setJustEnabled(false), 2000);
    } else {
      setNotificationsEnabled(false);
      setEnabled(false);
      syncToServer(false, time.hour, time.minute);

      // Unsubscribe from Web Push
      await unsubscribeFromPush();
    }
  };

  const handleTestNotification = async () => {
    // Synchronous ref guard — prevents double-submit from rapid taps even
    // before React can re-render with testStatus='sending'. Also prevents
    // re-firing during the post-success cooldown window.
    if (testInFlightRef.current) return;

    if (isDemo) {
      setTestStatus('demo');
      setTimeout(() => setTestStatus(''), 3000);
      return;
    }
    if (permission !== 'granted') {
      setTestStatus('denied');
      setTimeout(() => setTestStatus(''), 4000);
      return;
    }
    if (pushStatus !== 'subscribed') {
      setTestStatus('no-sub');
      setTimeout(() => setTestStatus(''), 4000);
      return;
    }

    testInFlightRef.current = true;
    setTestStatus('sending');
    try {
      // Server-sent Web Push — FCM (Android) / APNs (iOS), arrives as a
      // real system notification with sound + vibrate regardless of
      // foreground / background. Matches the production cron path.
      const result = await sb.sendTestPush();
      if (result.ok && result.sent > 0) {
        setTestStatus('fired');
        // Hold the button locked for 8 seconds after a successful fire so
        // the user doesn't accidentally stack multiple pushes (which on
        // iOS can pile up in notification center even with the same tag).
        setTimeout(() => {
          testInFlightRef.current = false;
          setTestStatus('cooldown');
          setTimeout(() => setTestStatus(''), 2000);
        }, 6000);
      } else {
        if (result.reason === 'no-subscription') {
          setTestStatus('no-sub');
        } else {
          setTestStatus('failed');
          console.warn('[test-push] failed:', result);
        }
        testInFlightRef.current = false;
        setTimeout(() => setTestStatus(''), 5000);
      }
    } catch (err) {
      console.error('[test-push] exception:', err);
      setTestStatus('failed');
      testInFlightRef.current = false;
      setTimeout(() => setTestStatus(''), 5000);
    }
  };

  // Server push fires from .github/workflows/cron-notify.yml, which runs at fixed
  // Taiwan-time hours — it does not read the patient's reminder time. Keep this string
  // in sync with that cron if the schedule changes; the copy below is the only place
  // patients learn when a push actually arrives.
  const PUSH_HOURS_LABEL = '中午 12:00 與晚上 20:00';

  if (!supported) return null;

  if (permission === 'denied') {
    return (
      <div className="card notif-card">
        <div className="card-header">
          <div className="card-icon" style={{ background: 'var(--danger-dim)' }}>🔕</div>
          <div>
            <div className="card-title">回報提醒</div>
            <span className="status-badge" style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}>
              通知已被封鎖
            </span>
          </div>
        </div>
        <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', margin: 0 }}>
          請至瀏覽器設定中重新開啟通知權限，才能收到回報提醒。
        </p>
      </div>
    );
  }

  return (
    <div className="card notif-card">
      <div className="card-header">
        <div className="card-icon" style={{ background: enabled ? 'var(--accent-dim)' : 'var(--bg-glass)' }}>
          {enabled ? '🔔' : '🔕'}
        </div>
        <div style={{ flex: 1 }}>
          <div className="card-title">回報提醒</div>
          {enabled && (
            <span className="status-badge completed" style={{ fontSize: '0.65rem' }}>
              {pushStatus === 'subscribed' ? '✓ 推播已開啟' : '✓ 已開啟'}
            </span>
          )}
        </div>

        <button
          className={`notif-toggle ${enabled ? 'active' : ''}`}
          onClick={handleToggle}
          aria-label={enabled ? '關閉通知' : '開啟通知'}
        >
          <span className="notif-toggle-knob" />
        </button>
      </div>

      {!enabled && (
        <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', margin: '8px 0 0' }}>
          開啟後，需回報的日子若還沒填寫，系統會在{PUSH_HOURS_LABEL}推播提醒您，
          沒有開啟 App 也收得到。
        </p>
      )}

      {enabled && (
        <div className="notif-settings">
          <div className="notif-time-row">
            <label htmlFor="reminder-hour" className="notif-time-label">提醒時間</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                id="reminder-hour"
                className="notif-time-input"
                value={time.hour}
                onChange={(e) => {
                  const h = Number(e.target.value);
                  setReminderTime(h, time.minute);
                  setTime({ hour: h, minute: time.minute });
                  syncToServer(enabled, h, time.minute);
                }}
                style={{ minWidth: 64 }}
                aria-label="提醒小時 (24 小時制)"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, '0')}
                  </option>
                ))}
              </select>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>:</span>
              <select
                className="notif-time-input"
                value={time.minute}
                onChange={(e) => {
                  const m = Number(e.target.value);
                  setReminderTime(time.hour, m);
                  setTime({ hour: time.hour, minute: m });
                  syncToServer(enabled, time.hour, m);
                }}
                style={{ minWidth: 64 }}
                aria-label="提醒分鐘"
              >
                {[0, 15, 30, 45].map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, '0')}
                  </option>
                ))}
              </select>
              <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginLeft: 4 }}>
                24h
              </span>
            </div>
          </div>
          <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', margin: '2px 0 8px', lineHeight: 1.4 }}>
            此時間只在 App 開著時生效。伺服器推播固定於{PUSH_HOURS_LABEL}發送。
          </p>
          <button
            className="btn btn-secondary notif-test-btn"
            onClick={handleTestNotification}
            disabled={testStatus === 'sending' || testStatus === 'fired' || testStatus === 'cooldown'}
          >
            {testStatus === 'sending'
              ? '📡 發送中…'
              : (testStatus === 'fired' || testStatus === 'cooldown')
                ? '✓ 已發送，請稍候'
                : '🔔 測試通知'}
          </button>
          {testStatus === 'sending' && (
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.4 }}>
              正在透過推播伺服器發送測試通知… 通常 3–10 秒內抵達裝置。
            </div>
          )}
          {testStatus === 'fired' && (
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--success)', marginTop: 6, lineHeight: 1.4 }}>
              ✓ 測試通知已從伺服器發出。應該會出現在通知列、有聲音與震動。<br />
              若 30 秒內還沒收到，請檢查系統通知設定 / 勿擾模式。
            </div>
          )}
          {testStatus === 'denied' && (
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--warning)', marginTop: 6, lineHeight: 1.4 }}>
              ⚠ 通知權限未授權。請先開啟上方每日提醒開關並允許通知權限。
            </div>
          )}
          {testStatus === 'no-sub' && (
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--warning)', marginTop: 6, lineHeight: 1.4 }}>
              ⚠ 尚未註冊推播訂閱。請先關掉每日提醒開關再重新打開，讓 App 重新向伺服器註冊。
            </div>
          )}
          {testStatus === 'demo' && (
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 6 }}>
              示範模式不支援真實推播測試。
            </div>
          )}
          {testStatus === 'failed' && (
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--danger)', marginTop: 6, lineHeight: 1.4 }}>
              ✗ 測試通知發送失敗。請檢查網路連線或稍後再試。
            </div>
          )}
          {justEnabled && (
            <div style={{
              fontSize: 'var(--font-xs)',
              color: 'var(--success)',
              marginTop: '6px',
              animation: 'fadeIn 0.3s ease',
            }}>
              ✓ 通知已開啟！需回報的日子若未填寫，將於{PUSH_HOURS_LABEL}收到推播提醒。
            </div>
          )}
          {pushStatus === 'error' && (
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--warning)', marginTop: '6px' }}>
              ⚠ 推播註冊失敗，將使用本機提醒作為備用。
            </div>
          )}
        </div>
      )}
    </div>
  );
}
