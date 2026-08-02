import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  saveReport as saveLocalReport,
  getTodayReport,
  getReportByDate as getLocalReportByDate,
} from '../utils/storage';
import * as sb from '../utils/supabaseService';
import { enqueueReport } from '../utils/offlineQueue';
import * as I from '../components/Icons';

const bleedingOptions = [
  { v: '無', d: '無任何出血' },
  { v: '少量', d: '擦拭時見血、點狀血跡' },
  { v: '持續', d: '排便後滴血、馬桶水變色', danger: true },
  { v: '血塊', d: '可見血塊排出', danger: true },
];
const bowelOptions = ['正常', '困難', '未排'];
const continenceOptions = [
  { v: '正常', label: '正常', d: '可以控制' },
  // Names stool explicitly. The previous wording ("內褲有少量污漬") captured any
  // underwear staining, which after a haemorrhoidectomy is usually wound discharge —
  // so discharge was being recorded here as a continence problem. The stored value is
  // unchanged (`滲便`), so this sharpens the operational definition without altering
  // the data structure. Changed 2026-08-02; treat that as the analysis split point.
  { v: '滲便', label: '偶爾漏便', d: '不自覺漏出糞便、內褲沾到便漬' },
  { v: '失禁', label: '無法控制', d: '來不及上廁所、大量漏出', danger: true },
];
const urinaryOptions = [
  { v: '正常', label: '正常', d: '排尿順暢' },
  { v: '困難', label: '不太順', d: '尿得出來但要等或要用力' },
  { v: '尿不出來', label: '完全尿不出來', d: '想尿但完全排不出，腹部脹痛', danger: true },
];
const woundOptions = ['無異常', '腫脹', '分泌物', '搔癢', '異物感', '其他'];

const PAIN_WORD = (v) => v === 0 ? '無痛' : v <= 3 ? '輕度疼痛' : v <= 6 ? '中度疼痛' : v <= 8 ? '嚴重疼痛' : '劇烈疼痛';
const PAIN_COLOR = (v) => v <= 3 ? 'var(--ok)' : v <= 6 ? 'var(--warn)' : 'var(--danger)';

export default function SymptomReport({ onComplete, isDemo, userInfo }) {
  const [searchParams] = useSearchParams();
  const today = new Date().toLocaleDateString('en-CA');
  // Validate ?date= param: must be YYYY-MM-DD, a real calendar date, and not
  // in the future. Reject anything else to prevent arbitrary report creation.
  const rawDate = searchParams.get('date') || null;
  const isValidPastDate = (d) => {
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    if (isNaN(Date.parse(d))) return false;
    return d <= today;
  };
  const editDate = isValidPastDate(rawDate) ? rawDate : null;
  const isEditingPast = !!editDate && editDate !== today;

  const targetDate = editDate || today;
  // Signed offset — negative means the date precedes surgery.
  const daysFromSurgeryFor = (date) => {
    if (!userInfo?.surgeryDate || !date) return 0;
    const s = new Date(userInfo.surgeryDate);
    const t = new Date(date);
    s.setHours(0, 0, 0, 0); t.setHours(0, 0, 0, 0);
    return Math.floor((t - s) / (1000 * 60 * 60 * 24));
  };
  const targetOffset = daysFromSurgeryFor(targetDate);
  const targetPod = Math.max(0, targetOffset);
  // A report dated before surgery would be stored as pod = 0 (the clamp) while
  // carrying a pre-operative report_date. Reports upsert on
  // (study_id, report_date), so the genuine POD 0 the next day lands in a
  // SECOND row — two POD 0 observations, one of them taken before the
  // operation, indistinguishable afterwards. Block it at the source.
  const isPreOp = targetOffset < 0;

  const demoExisting = isDemo
    ? (editDate ? getLocalReportByDate(editDate) : getTodayReport())
    : null;

  const parseWound = (raw) => {
    if (!raw) return { items: [], other: '' };
    const parts = typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
    const items = parts.map(p => p.startsWith('其他:') ? '其他' : p);
    const otherPart = parts.find(p => p.startsWith('其他:'));
    return { items, other: otherPart ? otherPart.slice(3) : '' };
  };

  const [loadingExisting, setLoadingExisting] = useState(!isDemo && !!userInfo?.studyId);
  const [pain, setPain] = useState(demoExisting?.pain ?? 3);
  const [bleeding, setBleeding] = useState(demoExisting?.bleeding ?? '');
  const [bowel, setBowel] = useState(demoExisting?.bowel ?? '');
  const [fever, setFever] = useState(demoExisting?.fever ?? false);
  const [continence, setContinence] = useState(demoExisting?.continence ?? '');
  const [urinary, setUrinary] = useState(demoExisting?.urinary ?? '');
  const [wound, setWound] = useState(() => parseWound(demoExisting?.wound).items);
  const [woundOther, setWoundOther] = useState(() => parseWound(demoExisting?.wound).other);
  const [showSuccess, setShowSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isDemo || !userInfo?.studyId) return;
    const load = async () => {
      try {
        const report = editDate
          ? await sb.getReportByDate(userInfo.studyId, editDate)
          : await sb.getTodayReport(userInfo.studyId);
        if (report) {
          setPain(report.pain_nrs ?? 3);
          setBleeding(report.bleeding ?? '');
          setBowel(report.bowel ?? '');
          setFever(report.fever ?? false);
          setContinence(report.continence ?? '');
          setUrinary(report.urinary ?? '');
          const { items, other } = parseWound(report.wound);
          setWound(items);
          setWoundOther(other);
        }
      } catch (e) {
        console.error('[SymptomReport] load existing failed:', e);
      }
      setLoadingExisting(false);
    };
    load();
  }, [isDemo, userInfo?.studyId, editDate]);

  const toggleWound = (opt) => {
    setWound(prev => {
      if (opt === '無異常') return prev.includes('無異常') ? [] : ['無異常'];
      const without = prev.filter(w => w !== '無異常');
      return without.includes(opt) ? without.filter(w => w !== opt) : [...without, opt];
    });
  };

  const isValid = bleeding && bowel && continence && urinary && wound.length > 0 && (!wound.includes('其他') || woundOther.trim());

  const handleSubmit = async () => {
    if (!isValid || submitting) return;
    // Second line of defence. The pre-op screen already prevents reaching this
    // form, but a stale tab left open across the surgery date, or a direct
    // ?date= link, would otherwise still write a pre-operative row.
    if (isPreOp) {
      setError(`手術日為 ${userInfo?.surgeryDate}，症狀回報從手術當天才開始。`);
      return;
    }
    setSubmitting(true);
    setError('');

    const woundValue = wound.map(w => w === '其他' ? `其他:${woundOther.trim()}` : w).join(',');
    const report = { pain, bleeding, bowel, fever, continence, urinary, wound: woundValue };

    try {
      if (isDemo) {
        saveLocalReport(report, targetDate, targetPod);
      } else {
        const savePromise = sb.saveReport(userInfo.studyId, targetPod, report, targetDate);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('提交逾時，請檢查網路後重試')), 10000)
        );
        await Promise.race([savePromise, timeoutPromise]);
      }

      setShowSuccess(true);
      setTimeout(() => {
        setShowSuccess(false);
        onComplete();
      }, 1800);
    } catch (err) {
      console.error('Submit error:', err);
      if (!isDemo && userInfo?.studyId && !navigator.onLine) {
        enqueueReport(userInfo.studyId, targetPod, { pain, bleeding, bowel, fever, continence, urinary, wound: woundValue }, targetDate);
        setShowSuccess(true);
        setTimeout(() => {
          setShowSuccess(false);
          onComplete();
        }, 1800);
        return;
      }
      setError('提交失敗：' + (err.message || '請稍後再試'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingExisting) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <p style={{ color: 'var(--ink-2)', animation: 'pulse 1s infinite', fontFamily: 'var(--font-mono)' }}>載入中…</p>
      </div>
    );
  }

  if (isPreOp) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', maxWidth: 320 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--accent-soft)', color: 'var(--accent)',
            display: 'grid', placeItems: 'center', margin: '0 auto var(--space-md)',
          }}>
            <I.Info width={24} height={24} />
          </div>
          <h2 className="page-title" style={{ fontSize: 18, marginBottom: 4 }}>手術尚未進行</h2>
          <p style={{ color: 'var(--ink-2)', fontSize: 12.5, marginBottom: 'var(--space-md)', lineHeight: 1.6 }}>
            您的手術日為 <strong>{userInfo?.surgeryDate}</strong>。<br />
            症狀回報從手術當天開始，在此之前無需填寫。
          </p>
          <button className="btn btn-secondary" onClick={onComplete}>返回首頁</button>
        </div>
      </div>
    );
  }

  if (showSuccess) {
    return (
      <div className="success-overlay">
        <div className="success-checkmark"><I.Check width={40} height={40} /></div>
        <div className="success-text">{isEditingPast ? '修改成功' : '回報成功'}</div>
        <div className="success-sub">{isEditingPast ? '資料已同步更新' : '感謝您的填寫，祝您早日康復'}</div>
      </div>
    );
  }

  const displayDate = new Date(targetDate).toLocaleDateString('zh-TW');

  return (
    <div className="page">
      <div className="topbar">
        <button className="icon-btn" onClick={() => onComplete()} aria-label="返回">
          <I.ArrowLeft width={17} height={17} />
        </button>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)', letterSpacing: '0.1em' }}>
          POD {targetPod} · {displayDate}
        </div>
        <div style={{ width: 36 }} />
      </div>

      <div className="page-head">
        <div className="eyebrow">{isEditingPast ? 'EDIT PAST REPORT' : 'DAILY REPORT'}</div>
        <h1 className="page-title">{isEditingPast ? `修改 POD ${targetPod} 回報` : '今日症狀回報'}</h1>
        <p className="page-sub">
          {isEditingPast
            ? `修改 ${displayDate} 的症狀紀錄 · 儲存後會同步更新資料庫`
            : '完整填寫約 30 秒 · 所有欄位為必填'}
        </p>
      </div>

      {/* Pain slider hero */}
      <div className="pain-hero">
        <div className="field-lbl" style={{ marginBottom: 4 }}>疼痛分數 <span className="hint">NRS 0–10</span></div>
        <div className="pain-display">
          <div className="pain-num" style={{ color: PAIN_COLOR(pain) }}>
            {pain}<span className="of">/10</span>
          </div>
          <div className="pain-word">
            Level
            <span className="lvl" style={{ color: PAIN_COLOR(pain) }}>{PAIN_WORD(pain)}</span>
          </div>
        </div>
        <div className="slider-wrap">
          <div className="slider-track-bg">
            <div className="slider-track-fill" style={{ width: `${(pain / 10) * 100}%`, background: PAIN_COLOR(pain) }} />
          </div>
          <input type="range" className="slider" min="0" max="10" value={pain} onChange={e => setPain(Number(e.target.value))} />
        </div>
        <div className="slider-ticks">
          <span>0 · 無痛</span>
          <span>5 · 中度</span>
          <span>10 · 劇痛</span>
        </div>
      </div>

      {/* Bleeding */}
      <div className="field">
        <div className="field-lbl">出血程度</div>
        <div className="opt-stack">
          {bleedingOptions.map(o => (
            <button key={o.v} type="button"
              className={`opt ${bleeding === o.v ? (o.danger ? 'selected danger' : 'selected') : ''}`}
              onClick={() => setBleeding(o.v)}>
              <span className="opt-main">{o.v}</span>
              <span className="opt-desc">{o.d}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Bowel */}
      <div className="field">
        <div className="field-lbl">排便狀況</div>
        <div className="opt-row">
          {bowelOptions.map(v => (
            <button key={v} type="button"
              className={`opt ${bowel === v ? 'selected' : ''}`}
              onClick={() => setBowel(v)}>
              <span className="opt-main">{v}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Continence */}
      <div className="field">
        <div className="field-lbl">
          {/* Says 傷口欄位, not the literal field label 傷口狀況: repeating the label
              gave the page two matches for it and broke the E2E locators. */}
          肛門控制 <span className="hint">若只是傷口分泌物或血水沾到內褲，請改在下方傷口欄位選「分泌物」</span>
        </div>
        <div className="opt-stack">
          {continenceOptions.map(o => (
            <button key={o.v} type="button"
              className={`opt ${continence === o.v ? (o.danger ? 'selected danger' : 'selected') : ''}`}
              onClick={() => setContinence(o.v)}>
              <span className="opt-main">{o.label}</span>
              <span className="opt-desc">{o.d}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Fever */}
      <div className="field">
        <div className="field-lbl">發燒 <span className="hint">體溫 ≥ 38°C</span></div>
        <div className="opt-row">
          <button type="button" className={`opt ${fever === false ? 'selected' : ''}`} onClick={() => setFever(false)}>
            <span className="opt-main">否</span>
          </button>
          <button type="button" className={`opt ${fever === true ? 'selected danger' : ''}`} onClick={() => setFever(true)}>
            <span className="opt-main">是</span>
          </button>
        </div>
      </div>

      {/* Urinary */}
      <div className="field">
        <div className="field-lbl">排尿狀況</div>
        <div className="opt-stack">
          {urinaryOptions.map(o => (
            <button key={o.v} type="button"
              className={`opt ${urinary === o.v ? (o.danger ? 'selected danger' : 'selected') : ''}`}
              onClick={() => setUrinary(o.v)}>
              <span className="opt-main">{o.label}</span>
              <span className="opt-desc">{o.d}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Wound (multi) */}
      <div className="field">
        <div className="field-lbl">傷口狀況 <span className="hint">可複選</span></div>
        <div className="chip-grid">
          {woundOptions.map(w => (
            <button key={w} type="button"
              className={`chip ${wound.includes(w) ? 'selected' : ''}`}
              onClick={() => toggleWound(w)}>{w}</button>
          ))}
        </div>
        {wound.includes('其他') && (
          <input className="input" style={{ marginTop: 8 }}
            placeholder="請描述傷口狀況…"
            value={woundOther}
            onChange={e => setWoundOther(e.target.value)} />
        )}
      </div>

      {error && (
        <div className="alert-banner danger" style={{ marginBottom: 12 }}>
          <div className="al-icon"><I.Alert width={18} height={18} /></div>
          <div><div className="al-msg">{error}</div></div>
        </div>
      )}

      <button className="btn btn-primary" disabled={!isValid || submitting} onClick={handleSubmit}>
        {submitting ? '提交中…' : <>{isEditingPast ? '儲存修改' : '提交回報'} <I.Check width={16} height={16} /></>}
      </button>
      <div style={{ fontSize: 11, color: 'var(--ink-3)', textAlign: 'center', marginTop: 10, fontFamily: 'var(--font-mono)' }}>
        <I.Shield width={11} height={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
        資料經過去識別化加密儲存
      </div>
    </div>
  );
}
