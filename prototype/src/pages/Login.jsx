import { useState, useEffect } from 'react';
import { signIn, signUp, resetPassword, checkStudyIdExists } from '../utils/supabaseService';
import * as I from '../components/Icons';

const SAVED_EMAIL_KEY = 'saved_login_email';
const REMEMBER_KEY = 'remember_login';

const SURGEONS = [
  { prefix: 'HSF', name: '黃士峯' },
  { prefix: 'HCW', name: '許詔文' },
  { prefix: 'WJH', name: '王瑞和' },
  { prefix: 'CPT', name: '朱炳騰' },
  { prefix: 'WCC', name: '吳志謙' },
  { prefix: 'LMH', name: '李明泓' },
  { prefix: 'CYH', name: '陳禹勳' },
  { prefix: 'FIH', name: '方翊軒' },
];

const ERROR_MAP = {
  'Invalid login credentials': '帳號或密碼錯誤，請重新輸入',
  'Email not confirmed': '電子郵件尚未驗證，請查看信箱',
  'User already registered': '此電子郵件已註冊，請直接登入',
  'Password should be at least 6 characters': '密碼至少需要 6 個字元',
  'Unable to validate email address: invalid format': '電子郵件格式不正確',
  'Signup requires a valid password': '請輸入有效的密碼',
  'User not found': '查無此帳號，請確認電子郵件是否正確',
  'Email rate limit exceeded': '請求過於頻繁，請稍後再試',
  'For security purposes, you can only request this after': '操作過於頻繁，請稍後再試',
};

function translateError(msg, mode = 'login') {
  const fallback = mode === 'register'
    ? '建立帳號失敗，請確認邀請碼與資料是否正確'
    : mode === 'forgot'
      ? '重設密碼失敗，請稍後再試'
      : '登入失敗，請檢查帳號密碼';
  if (!msg) return fallback;
  if (/[\u4e00-\u9fff]/.test(msg)) return msg;
  for (const [en, zh] of Object.entries(ERROR_MAP)) {
    if (msg.includes(en)) return zh;
  }
  // Unmapped English error — surface it so the user knows what went wrong
  return `${fallback}（${msg}）`;
}

export default function Login({ onLogin, theme, onToggleTheme }) {
  const [mode, setMode] = useState('login');
  const [role, setRole] = useState('patient');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [surgeonPrefix, setSurgeonPrefix] = useState('');
  const [patientNumber, setPatientNumber] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [surgeryDate, setSurgeryDate] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem(REMEMBER_KEY) === 'true');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (rememberMe) {
      const saved = localStorage.getItem(SAVED_EMAIL_KEY);
      if (saved) setEmail(saved);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'forgot') {
        if (!email.trim()) throw new Error('請輸入電子郵件');
        await resetPassword(email.trim());
        setResetSent(true);
      } else if (mode === 'register') {
        if (!inviteCode.trim()) throw new Error('請輸入邀請碼。');
        if (!surgeonPrefix) throw new Error('請選擇主刀醫師。');
        if (!patientNumber.trim() || !/^\d{1,4}$/.test(patientNumber.trim())) {
          throw new Error('請輸入病人編號（1-4 位數字）。');
        }
        const studyId = `${surgeonPrefix}-${patientNumber.trim().padStart(3, '0')}`;
        const exists = await checkStudyIdExists(studyId);
        if (exists) throw new Error(`研究編號 ${studyId} 已存在，請使用其他編號。`);
        sessionStorage.setItem('invite_token', inviteCode.trim());
        await signUp(email, password, {
          role: 'patient',
          study_id: studyId,
          surgery_date: surgeryDate || new Date().toLocaleDateString('en-CA'),
        });
        setError('');
        setMode('login');
        alert('帳號建立成功！請登入。');
      } else {
        await signIn(email, password);
        if (rememberMe) {
          localStorage.setItem(SAVED_EMAIL_KEY, email.trim());
          localStorage.setItem(REMEMBER_KEY, 'true');
        } else {
          localStorage.removeItem(SAVED_EMAIL_KEY);
          localStorage.removeItem(REMEMBER_KEY);
        }
      }
    } catch (err) {
      setError(translateError(err.message, mode));
    } finally {
      setLoading(false);
    }
  };

  const handleDemo = () => {
    if (role === 'researcher') {
      onLogin({ demo: true, studyId: 'RESEARCHER', role: 'researcher' });
    } else {
      onLogin({ demo: true, studyId: 'DEMO-001' });
    }
  };

  return (
    <div className="login">
      {onToggleTheme && (
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? '切換到淺色模式' : '切換到深色模式'}
          style={{ position: 'absolute', top: 18, right: 18, zIndex: 10 }}
        >
          {theme === 'dark' ? <I.Sun width={16} height={16} /> : <I.Moon width={16} height={16} />}
        </button>
      )}

      <div className="login-logo-img">
        <img src="/KSVGH.png" alt="KSVGH" onError={(e) => { e.target.style.display = 'none'; }} />
      </div>
      <div className="login-hosp">高雄榮總 · 大腸直腸外科</div>
      <h1 className="login-title">術後追蹤系統</h1>
      <p className="login-sub">痔瘡手術術後症狀監測與 AI 衛教</p>

      {mode !== 'forgot' && (
        <div className="seg">
          <button className={mode === 'login' ? 'on' : ''}
            onClick={() => { setMode('login'); setError(''); }}>登入</button>
          <button className={mode === 'register' ? 'on' : ''}
            onClick={() => { setMode('register'); setError(''); }}>註冊</button>
        </div>
      )}

      {mode === 'forgot' && (
        <div className="input-group" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>重設密碼</div>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
            輸入您的電子郵件，我們會寄送重設連結。
          </p>
        </div>
      )}

      {mode !== 'forgot' && (
        <div className="role-toggle">
          <button className={role === 'patient' ? 'on' : ''} onClick={() => setRole('patient')}>
            <I.User width={12} height={12} /> 病人
          </button>
          <button className={role === 'researcher' ? 'on' : ''} onClick={() => setRole('researcher')}>
            <I.Chart width={12} height={12} /> 研究人員
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {mode === 'register' && (
          <>
            <div className="input-group">
              <label className="input-lbl">邀請碼 · Invite Code</label>
              <input className="input" placeholder="請輸入研究團隊提供的邀請碼"
                value={inviteCode} onChange={e => setInviteCode(e.target.value)} required />
            </div>
            <div className="input-group">
              <label className="input-lbl">手術日期</label>
              <input className="input" type="date" value={surgeryDate}
                onChange={e => setSurgeryDate(e.target.value)} required />
            </div>
            <div className="input-group">
              <label className="input-lbl">主刀醫師</label>
              <select className="input" style={{ appearance: 'auto' }} value={surgeonPrefix}
                onChange={e => setSurgeonPrefix(e.target.value)} required>
                <option value="">請選擇主刀醫師</option>
                {SURGEONS.map(s => (
                  <option key={s.prefix} value={s.prefix}>{s.name}（{s.prefix}）</option>
                ))}
              </select>
            </div>
            <div className="input-group">
              <label className="input-lbl">病人編號</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent)',
                  fontWeight: 600, minWidth: 40, textAlign: 'right',
                }}>
                  {surgeonPrefix || '???'}-
                </span>
                <input className="input" style={{ flex: 1 }} type="text"
                  inputMode="numeric" pattern="[0-9]*" placeholder="001"
                  value={patientNumber}
                  onChange={e => setPatientNumber(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  required />
              </div>
              {surgeonPrefix && patientNumber && (
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
                  研究編號：<strong style={{ color: 'var(--accent)' }}>{surgeonPrefix}-{patientNumber.padStart(3, '0')}</strong>
                </div>
              )}
            </div>
          </>
        )}

        <div className="input-group">
          <label className="input-lbl">電子郵件</label>
          <input className="input" type="email" placeholder="your@email.com"
            value={email} onChange={e => setEmail(e.target.value)} required />
        </div>

        {mode !== 'forgot' && (
          <div className="input-group">
            <label className="input-lbl">密碼</label>
            <div className="input-password-wrap">
              <input className="input"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required minLength={6} />
              <button type="button" className="input-eye"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
                tabIndex={-1}>
                {showPassword ? <I.EyeOff width={18} height={18} /> : <I.Eye width={18} height={18} />}
              </button>
            </div>
          </div>
        )}

        {mode === 'login' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={rememberMe}
              onChange={(e) => {
                setRememberMe(e.target.checked);
                if (!e.target.checked) {
                  localStorage.removeItem(SAVED_EMAIL_KEY);
                  localStorage.removeItem(REMEMBER_KEY);
                }
              }}
              style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
            <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>記住我的帳號</span>
          </label>
        )}

        {error && (
          <div className="alert-banner danger" style={{ marginBottom: 12 }}>
            <div className="al-icon"><I.Alert width={18} height={18} /></div>
            <div>
              <div className="al-msg">{error}</div>
            </div>
          </div>
        )}

        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? '處理中…' : mode === 'login' ? '登入' : mode === 'forgot' ? '發送重設連結' : '建立帳號'}
          {!loading && <I.Chevron width={14} height={14} />}
        </button>

        {mode === 'login' && (
          <button type="button"
            onClick={() => { setMode('forgot'); setError(''); setResetSent(false); }}
            style={{
              background: 'none', border: 'none', color: 'var(--ink-3)',
              fontSize: 11, cursor: 'pointer', marginTop: 10,
              textDecoration: 'underline', width: '100%', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
            }}>忘記密碼？</button>
        )}

        {mode === 'forgot' && resetSent && (
          <div style={{ color: 'var(--ok)', fontSize: 12.5, marginTop: 10, textAlign: 'center' }}>
            ✓ 重設連結已寄出，請查看您的信箱。
          </div>
        )}

        {mode === 'forgot' && (
          <button type="button"
            onClick={() => { setMode('login'); setError(''); setResetSent(false); }}
            style={{
              background: 'none', border: 'none', color: 'var(--accent)',
              fontSize: 12, cursor: 'pointer', marginTop: 10, width: '100%', fontFamily: 'var(--font-mono)',
            }}>← 返回登入</button>
        )}
      </form>

      {import.meta.env.DEV && (
        <button className="btn btn-ghost" type="button" onClick={handleDemo} style={{ marginTop: 10 }}>
          <I.User width={14} height={14} /> Demo 模式（無需登入）
        </button>
      )}

      <div style={{
        textAlign: 'center', fontSize: 10.5, color: 'var(--ink-3)',
        marginTop: 18, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
      }}>
        <I.Shield width={10} height={10} style={{ verticalAlign: 'middle', marginRight: 4 }} />
        IRB approved · 資料加密儲存 · RLS 隔離
      </div>
    </div>
  );
}
