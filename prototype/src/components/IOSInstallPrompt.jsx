import { useState } from 'react';

/**
 * iOS PWA install prompt — shows a banner guiding iOS Safari users
 * to "Add to Home Screen" for full PWA features (notifications, etc.)
 */
export default function IOSInstallPrompt() {
  const [show, setShow] = useState(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    const dismissed = localStorage.getItem('ios-install-dismissed');
    return isIOS && !isStandalone && !dismissed;
  });

  const handleDismiss = () => {
    localStorage.setItem('ios-install-dismissed', 'true');
    setShow(false);
  };

  if (!show) return null;

  return (
    <div style={{
      position: 'fixed', bottom: '70px', left: '16px', right: '16px',
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', padding: '16px',
      boxShadow: 'var(--shadow-card)', zIndex: 9998,
      animation: 'slideUp 0.3s ease-out',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, marginBottom: '6px', fontSize: 'var(--font-sm)' }}>
            📱 安裝到主畫面
          </div>
          <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
            點選 Safari 底部的 <strong style={{ fontSize: '1.1em' }}>⎙</strong>（分享按鈕），
            然後選擇「<strong>加入主畫面</strong>」，即可獲得完整通知功能。
          </p>
        </div>
        <button
          onClick={handleDismiss}
          style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            fontSize: '1.2rem', cursor: 'pointer', padding: '0 0 0 8px',
          }}
        >✕</button>
      </div>
    </div>
  );
}
