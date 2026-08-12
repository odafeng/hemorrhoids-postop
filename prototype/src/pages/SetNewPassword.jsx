import { useState } from 'react';
import { updatePassword } from '../utils/supabaseService';
import * as I from '../components/Icons';

/**
 * Shown after a password-recovery link is opened.
 *
 * Supabase's recovery link only signs the user in; it does not change the
 * password. Before this screen existed the app treated that session like any
 * other login and dropped straight into the dashboard, so "忘記密碼" appeared
 * to do nothing and the account kept its old password.
 */
export default function SetNewPassword({ email, reason = 'recovery', onDone, onCancel }) {
  const isInvite = reason === 'invite';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('密碼至少需要 6 個字元');
      return;
    }
    if (password !== confirm) {
      setError('兩次輸入的密碼不一致');
      return;
    }
    setSaving(true);
    try {
      await updatePassword(password);
      onDone();
    } catch (err) {
      setError(err?.message || '密碼設定失敗，請重新點擊信件中的連結後再試一次。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="login">
      <div className="login-logo-img">
        <img src="/KSVGH.png" alt="KSVGH" onError={(e) => { e.target.style.display = 'none'; }} />
      </div>
      <div className="login-hosp">高雄榮總 · 大腸直腸外科</div>
      <h1 className="login-title">設定新密碼</h1>
      <p className="login-sub">
        {[email, isInvite ? '歡迎加入，請設定您的登入密碼' : '請輸入您的新密碼']
          .filter(Boolean)
          .join(' · ')}
      </p>

      <form onSubmit={handleSubmit}>
        <div className="input-group">
          <label className="input-lbl">新密碼</label>
          <div className="input-password-wrap">
            <input
              className="input"
              type={showPassword ? 'text' : 'password'}
              placeholder="至少 6 個字元"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={6}
            />
            <button
              type="button"
              className="input-eye"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
              tabIndex={-1}
            >
              {showPassword ? <I.EyeOff width={18} height={18} /> : <I.Eye width={18} height={18} />}
            </button>
          </div>
        </div>

        <div className="input-group">
          <label className="input-lbl">再次輸入新密碼</label>
          <input
            className="input"
            type={showPassword ? 'text' : 'password'}
            placeholder="請再輸入一次"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            minLength={6}
          />
        </div>

        {error && (
          <div className="alert-banner danger" style={{ marginBottom: 12 }}>
            <div className="al-icon"><I.Alert width={18} height={18} /></div>
            <div><div className="al-msg">{error}</div></div>
          </div>
        )}

        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? '設定中…' : '設定新密碼'}
          {!saving && <I.Chevron width={14} height={14} />}
        </button>

        {/* Recovery can be postponed — the old password still works. An invite
            cannot: backing out logs the researcher into nothing, because the
            password on their account is one GoTrue invented and never showed
            anybody. */}
        {onCancel && !isInvite && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              background: 'none', border: 'none', color: 'var(--ink-3)',
              fontSize: 11, cursor: 'pointer', marginTop: 10,
              textDecoration: 'underline', width: '100%',
              fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
            }}
          >
            稍後再設定
          </button>
        )}
      </form>
    </div>
  );
}
