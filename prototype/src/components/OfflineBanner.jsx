import { useState, useEffect } from 'react';
import { getQueueCount } from '../utils/offlineQueue';

export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [queueCount, setQueueCount] = useState(() => getQueueCount());

  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setQueueCount(getQueueCount()), 5000);
    return () => clearInterval(interval);
  }, []);

  // Stay visible while anything is still queued. Hiding as soon as the network
  // returns meant a report that fails to flush — one the patient was already
  // shown a success tick for — could sit in localStorage forever with no
  // indication anywhere in the UI that it never reached the study database.
  if (!isOffline && queueCount === 0) return null;

  const stuckOnline = !isOffline && queueCount > 0;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: stuckOnline ? 'var(--danger)' : 'var(--warning)',
      color: stuckOnline ? '#fff' : '#000',
      textAlign: 'center', padding: '6px 16px',
      fontSize: 'var(--font-xs)', fontWeight: 600,
    }}>
      {stuckOnline
        ? `⚠️ ${queueCount} 筆回報尚未送出，請保持連線；若持續出現請聯絡研究團隊`
        : queueCount > 0
          ? `📡 離線中 — ${queueCount} 筆回報已暫存，上線後自動提交`
          : '📡 目前離線中 — 部分功能可能無法使用'}
    </div>
  );
}
