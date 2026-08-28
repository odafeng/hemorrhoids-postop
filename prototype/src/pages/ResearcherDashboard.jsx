import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getResearcherMockData } from '../utils/storage';
import * as sb from '../utils/supabaseService';
import ResearcherCharts from '../components/ResearcherCharts';
import { downloadCSV, downloadJSON } from '../utils/csvExport';
import { closeOutBadge, closeOutState } from '../utils/followup';
import * as I from '../components/Icons';

const SURGEON_NAMES = {
  HSF: '黃士峯', HCW: '許詔文', WJH: '王瑞和', CPT: '朱炳騰',
  WCC: '吳志謙', LMH: '李明泓', CYH: '陳禹勳', FIH: '方翊軒',
};
const SURGEON_PREFIXES = Object.keys(SURGEON_NAMES);

const getSurgeonId = (p) => p.surgeon_id || (p.study_id?.includes('-') ? p.study_id.split('-')[0].toUpperCase() : null);

// e2e 常駐帳號。它不回報症狀，依從率恆為 0%，且 expected_reports 逐日累加，
// 留在統計裡會把整體依從率愈拉愈低。只排除於統計與圖表，收案列表仍照常顯示——
// e2e/researcher-flow.spec.ts 會搜尋並斷言該列可見。
const NON_SUBJECT_STUDY_IDS = new Set(['TEST-001']);
const isStudySubject = (row) => !NON_SUBJECT_STUDY_IDS.has(row.study_id);

// IRB Ver 2 (2026.04.14) 的收案目標。
const ENROLMENT_TARGET = 50;

export default function ResearcherDashboard({ onNavigate, isDemo, userInfo, onLogout }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [patients, setPatients] = useState([]);
  const [adherence, setAdherence] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [unreviewedCount, setUnreviewedCount] = useState(0);
  const [ackingId, setAckingId] = useState(null);
  const [allReports, setAllReports] = useState([]);
  const [surgeonFilter, setSurgeonFilter] = useState('all');
  const [exporting, setExporting] = useState(false);
  const [exportType, setExportType] = useState(null);

  // Invite token state
  const [invitePrefix, setInvitePrefix] = useState('HSF');
  const [inviteNum, setInviteNum] = useState('');
  const [inviteCreating, setInviteCreating] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [inviteError, setInviteError] = useState('');
  const [recentInvites, setRecentInvites] = useState([]);

  // Researcher invite state (PI-only)
  const [researcherEmail, setResearcherEmail] = useState('');
  const [researcherName, setResearcherName] = useState('');
  const [researcherRole, setResearcherRole] = useState('researcher');
  const [researcherSurgeon, setResearcherSurgeon] = useState('HSF');
  const [researcherPassword, setResearcherPassword] = useState('');
  const [researcherInviting, setResearcherInviting] = useState(false);
  const [researcherResult, setResearcherResult] = useState('');
  const [researcherError, setResearcherError] = useState('');

  // Researcher list state (PI-only)
  const [teamList, setTeamList] = useState([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState('');
  const [teamNotice, setTeamNotice] = useState('');
  const [banningId, setBanningId] = useState(null);
  const [resettingId, setResettingId] = useState(null);

  const loadTeam = async () => {
    setTeamLoading(true); setTeamError('');
    try {
      const list = await sb.listResearchers();
      setTeamList(list);
    } catch (err) {
      setTeamError(err?.message || '載入失敗');
    } finally {
      setTeamLoading(false);
    }
  };

  useEffect(() => {
    if (!isDemo && userInfo?.role === 'pi') loadTeam();
  }, [isDemo, userInfo?.role]);

  const toggleBan = async (u) => {
    const isBanned = !!u.banned_until && new Date(u.banned_until) > new Date();
    const verb = isBanned ? '啟用' : '停用';
    if (!window.confirm(`確定要${verb}「${u.display_name || u.email}」嗎？`)) return;
    setBanningId(u.id);
    try {
      if (isBanned) await sb.unbanResearcher(u.id);
      else await sb.banResearcher(u.id);
      await loadTeam();
    } catch (err) {
      alert(`${verb}失敗：${err?.message || '未知錯誤'}`);
    } finally {
      setBanningId(null);
    }
  };

  const resetInitialPassword = async (u) => {
    const pw = window.prompt(
      `替「${u.display_name || u.email}」設定新的初始密碼（至少 8 個字元）。\n設定後請當面或用 LINE 告訴本人，他下次登入時必須改掉。`,
    );
    if (pw === null) return;
    setTeamError('');
    setTeamNotice('');
    if (pw.length < 8) {
      setTeamError('初始密碼至少需要 8 個字元');
      return;
    }
    setResettingId(u.id);
    try {
      await sb.resetResearcherInitialPassword(u.id, pw);
      setTeamNotice(`已重設 ${u.email} 的初始密碼，請把新密碼交給本人`);
    } catch (err) {
      setTeamError(err?.message || '重設失敗');
    } finally {
      setResettingId(null);
    }
  };

  useEffect(() => {
    if (!isDemo) {
      sb.listStudyInvites().then(rows => setRecentInvites(rows.slice(0, 5)));
    }
  }, [isDemo]);

  const handleCreateInvite = async () => {
    setInviteError(''); setInviteResult(null);
    if (!inviteNum.trim() || !/^\d{1,4}$/.test(inviteNum.trim())) {
      setInviteError('請輸入 1-4 位數字的病人編號'); return;
    }
    const studyId = `${invitePrefix}-${inviteNum.trim().padStart(3, '0')}`;
    setInviteCreating(true);
    try {
      const row = await sb.createStudyInvite(studyId);
      setInviteResult(row);
      setInviteNum('');
      sb.listStudyInvites().then(rows => setRecentInvites(rows.slice(0, 5)));
    } catch (err) {
      setInviteError(err?.message || '建立失敗');
    } finally {
      setInviteCreating(false);
    }
  };

  const copyToken = (token) => {
    try {
      navigator.clipboard.writeText(token);
    } catch { /* clipboard best-effort */ }
  };

  const handleInviteResearcher = async () => {
    setResearcherError(''); setResearcherResult('');
    if (!researcherEmail.trim() || !researcherName.trim()) {
      setResearcherError('請輸入 Email 與姓名'); return;
    }
    if (researcherRole === 'researcher' && !researcherSurgeon) {
      setResearcherError('請選擇所屬主刀醫師'); return;
    }
    if (researcherPassword.length < 8) {
      setResearcherError('初始密碼至少需要 8 個字元'); return;
    }
    setResearcherInviting(true);
    try {
      await sb.inviteResearcher(
        researcherEmail.trim(),
        researcherName.trim(),
        researcherRole,
        researcherSurgeon || null,
        researcherPassword,
      );
      setResearcherResult(`✓ 已建立 ${researcherEmail.trim()}，請把初始密碼交給本人。他首次登入時系統會要求改成自己的密碼。`);
      setResearcherEmail('');
      setResearcherName('');
      setResearcherPassword('');
      loadTeam();
    } catch (err) {
      setResearcherError(err?.message || '建立帳號失敗');
    } finally {
      setResearcherInviting(false);
    }
  };

  const today = new Date().toLocaleDateString('en-CA');

  useEffect(() => { loadData(); }, [isDemo]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadData = async () => {
    setLoading(true);
    setLoadError('');
    try {
      if (isDemo) {
        const mock = getResearcherMockData();
        setPatients(mock.patients);
        setAdherence(mock.adherence);
        setAlerts(mock.alerts);
        setUnreviewedCount(mock.chatLogs.filter(c => !c.reviewed).length);
        setAllReports(mock.reports || []);
      } else {
        const [pts, adh, alts, chats, reports] = await Promise.all([
          sb.getAllPatients(),
          sb.getAdherenceSummary(),
          sb.getAllAlertsForResearcher(),
          sb.getUnreviewedChats(),
          sb.getAllReportsForResearcher(),
        ]);
        setPatients(pts);
        setAdherence(adh);
        setAlerts(alts);
        setUnreviewedCount(chats.length);
        setAllReports(reports);
      }
    } catch (err) {
      // Never fall through to a rendered dashboard on a read failure: an empty
      // alerts list is pixel-identical to "every patient is fine", and this
      // screen is where the 24h alert review actually happens.
      console.error('Researcher data error:', err);
      setLoadError(err?.message || '資料載入失敗');
    } finally {
      setLoading(false);
    }
  };

  const studyPatients = patients.filter(isStudySubject);
  const studyAdherence = adherence.filter(isStudySubject);
  const activePatients = studyPatients.filter(p => p.study_status === 'active').length;
  const avgAdherence = studyAdherence.length > 0
    ? (studyAdherence.reduce((sum, a) => sum + Number(a.adherence_pct), 0) / studyAdherence.length).toFixed(1)
    : 0;
  const closeStates = studyPatients.map(p => closeOutState(
    p.study_status, p.surgery_date ? sb.getPODFromDate(p.surgery_date) : null, p.surgery_date));
  const closedCount = closeStates.filter(c => c.kind === 'closed').length;
  const overdueCount = closeStates.filter(c => c.kind === 'overdue').length;
  const closingCount = closeStates.filter(c => c.kind === 'closing' || c.kind === 'due').length;
  const activeAlerts = alerts.filter(a => !a.acknowledged).length;

  const handleAcknowledge = async (alertId) => {
    if (isDemo) {
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, acknowledged: true } : a));
      return;
    }
    setAckingId(alertId);
    try {
      await sb.acknowledgeAlert(alertId, userInfo?.studyId || 'researcher');
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, acknowledged: true } : a));
    } catch (err) {
      console.error('Acknowledge error:', err);
    } finally {
      setAckingId(null);
    }
  };

  const handleExportCSV = async () => {
    setExporting(true); setExportType('reports');
    try {
      const reports = isDemo ? allReports : await sb.getAllReportsForResearcher();
      downloadCSV(reports,
        ['study_id', 'report_date', 'pod', 'pain_nrs', 'bleeding', 'bowel', 'fever', 'wound', 'urinary', 'continence', 'report_source', 'reported_at'],
        `symptom_reports_${today}.csv`);
    } catch (err) { alert('匯出失敗：' + err.message); }
    finally { setExporting(false); setExportType(null); }
  };
  const handleExportAlerts = async () => {
    setExporting(true); setExportType('alerts');
    try {
      const data = isDemo ? alerts : await sb.getAllAlertsForResearcher();
      downloadCSV(data,
        ['id', 'study_id', 'alert_type', 'alert_level', 'message', 'triggered_at', 'acknowledged', 'acknowledged_by', 'acknowledged_at'],
        `alerts_${today}.csv`);
    } catch (err) { alert('匯出失敗：' + err.message); }
    finally { setExporting(false); setExportType(null); }
  };
  const handleExportChats = async () => {
    setExporting(true); setExportType('chats');
    try {
      const data = isDemo ? [] : await sb.getAllChatsForResearcher();
      downloadCSV(data,
        ['id', 'study_id', 'user_message', 'ai_response', 'matched_topic', 'reviewed', 'review_result', 'review_notes', 'created_at'],
        `ai_chat_logs_${today}.csv`);
    } catch (err) { alert('匯出失敗：' + err.message); }
    finally { setExporting(false); setExportType(null); }
  };
  const handleFullBackup = async () => {
    setExporting(true); setExportType('backup');
    try {
      let data;
      if (isDemo) {
        const mock = getResearcherMockData();
        data = { patients: mock.patients, symptom_reports: mock.reports, alerts: mock.alerts, ai_chat_logs: mock.chatLogs };
      } else {
        const [reports, alertData, chats, pts] = await Promise.all([
          sb.getAllReportsForResearcher(),
          sb.getAllAlertsForResearcher(),
          sb.getAllChatsForResearcher(),
          sb.getAllPatients(),
        ]);
        data = { patients: pts, symptom_reports: reports, alerts: alertData, ai_chat_logs: chats };
      }
      downloadJSON(data, `full_backup_${today}.json`);
    } catch (err) { alert('備份失敗：' + err.message); }
    finally { setExporting(false); setExportType(null); }
  };

  const surgeonIds = [...new Set(patients.map(getSurgeonId).filter(Boolean))].sort();
  const patientRows = patients
    .map(p => {
      const adh = adherence.find(a => a.study_id === p.study_id) || {};
      const podNum = p.surgery_date ? sb.getPODFromDate(p.surgery_date) : null;
      return {
        ...p, ...adh, _surgeonId: getSurgeonId(p), _pod: podNum,
        _close: closeOutState(p.study_status, podNum, p.surgery_date),
      };
    })
    .filter(p => surgeonFilter === 'all' || p._surgeonId === surgeonFilter);

  if (loading) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <p style={{ color: 'var(--ink-2)', animation: 'pulse 1s infinite', fontFamily: 'var(--font-mono)' }}>載入中…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', maxWidth: 340 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--danger-soft)', color: 'var(--danger)',
            display: 'grid', placeItems: 'center', margin: '0 auto var(--space-md)',
          }}>
            <I.Alert width={24} height={24} />
          </div>
          <h2 className="page-title" style={{ fontSize: 18, marginBottom: 4 }}>資料載入失敗</h2>
          <p style={{ color: 'var(--ink-2)', fontSize: 12.5, marginBottom: 'var(--space-md)' }}>
            目前畫面<strong>不代表沒有警示</strong>，請重新載入後再判讀。
          </p>
          <p style={{
            color: 'var(--ink-3)', fontSize: 11, marginBottom: 'var(--space-md)',
            fontFamily: 'var(--font-mono)', wordBreak: 'break-all',
          }}>{loadError}</p>
          <button className="btn btn-primary" onClick={loadData}>重新載入</button>
        </div>
      </div>
    );
  }

  const statusTone = (row) => row.had_alerts ? 'danger' : (row.adherence_pct ?? 0) < 50 ? 'warn' : null;
  const statusLabel = (row) => row.had_alerts ? '警示' : (row.adherence_pct ?? 0) < 50 ? '觀察' : '穩定';

  return (
    <div className="page">
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark"><img src="/KSVGH.png" alt="KSVGH" /></div>
          <div className="brand-text">
            <div className="hospital">KSVGH · RESEARCH{isDemo && ' · DEMO'}</div>
            <div className="system">研究者儀表板 · {userInfo?.role === 'pi' ? '主持人' : '研究團隊'}</div>
          </div>
        </div>
        <button className="icon-btn" onClick={onLogout} aria-label="登出">
          <I.LogOut width={17} height={17} />
        </button>
      </div>

      <div className="eyebrow" style={{ margin: '14px 0 8px' }}>IRB-2026-CRS-041 · COHORT OVERVIEW</div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-lbl">ENROLLED</div>
          {/* 累計收案，不是「目前仍在追蹤」。結案上線前兩者永遠相等，所以這裡
              原本放 activePatients 也看不出問題；現在受試者一結案，招募進度的
              數字就會往下掉，收滿並全部追蹤完成時會顯示 0。 */}
          <div className="stat-val">{studyPatients.length}</div>
          <div className="stat-foot">
            of {ENROLMENT_TARGET} 目標 · 追蹤中 {activePatients}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-lbl">ADHERENCE</div>
          <div className="stat-val" style={{ color: avgAdherence >= 70 ? 'var(--ok)' : 'var(--warn)' }}>
            {avgAdherence}<span className="sub">%</span>
          </div>
          <div className={`stat-foot ${avgAdherence >= 70 ? 'ok' : 'warn'}`}>目標 ≥ 70%</div>
        </div>
        <div className="stat-card" data-tone={overdueCount > 0 ? 'danger' : null}>
          <div className="stat-lbl">CLOSE-OUT</div>
          <div className="stat-val">{closedCount}</div>
          <div className={`stat-foot ${overdueCount > 0 ? 'danger' : closingCount > 0 ? 'warn' : 'ok'}`}>
            {overdueCount > 0
              ? `${overdueCount} 人逾期未結案`
              : closingCount > 0 ? `${closingCount} 人一週內到期` : '無待結案'}
          </div>
        </div>
        <div className="stat-card" data-tone={activeAlerts > 0 ? 'danger' : null}>
          <div className="stat-lbl">ALERTS</div>
          <div className="stat-val">{activeAlerts}</div>
          <div className={`stat-foot ${activeAlerts > 0 ? 'danger' : 'ok'}`}>
            {activeAlerts > 0 ? '需要追蹤' : '已處理'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-lbl">PENDING AI</div>
          <div className="stat-val" style={{ color: unreviewedCount > 0 ? 'var(--warn)' : 'var(--ok)' }}>
            {unreviewedCount}
          </div>
          <div className={`stat-foot ${unreviewedCount > 0 ? 'warn' : 'ok'}`}>待審核</div>
        </div>
      </div>

      <button className={`btn ${unreviewedCount > 0 ? 'btn-primary' : 'btn-secondary'}`}
        onClick={() => onNavigate('chatReview')}
        style={{ marginBottom: 12 }}>
        <I.Message width={14} height={14} />
        {unreviewedCount > 0 ? `審核 AI 回覆（${unreviewedCount} 則待審）` : 'AI 回覆審核紀錄'}
      </button>

      {/* Export */}
      <div className="card">
        <div className="card-head">
          <div className="card-head-left">
            <div className="card-icon ok"><I.Shield width={14} height={14} /></div>
            <div>
              <div className="card-kicker">Data Export</div>
              <div className="card-title">資料匯出</div>
            </div>
          </div>
        </div>
        <div className="btn-row" style={{ marginBottom: 10 }}>
          <button className="btn btn-secondary" onClick={handleExportCSV} disabled={exporting}>
            <I.Clipboard width={14} height={14} />
            {exportType === 'reports' ? '匯出中…' : '症狀回報'}
          </button>
          <button className="btn btn-secondary" onClick={handleExportAlerts} disabled={exporting}>
            <I.Alert width={14} height={14} />
            {exportType === 'alerts' ? '匯出中…' : '警示紀錄'}
          </button>
        </div>
        <button className="btn btn-secondary" onClick={handleExportChats} disabled={exporting} style={{ marginBottom: 10 }}>
          <I.Message width={14} height={14} />
          {exportType === 'chats' ? '匯出中…' : 'AI 對話紀錄 CSV'}
        </button>
        <button className="btn btn-primary" onClick={handleFullBackup} disabled={exporting}>
          <I.Shield width={14} height={14} />
          {exportType === 'backup' ? '備份中…' : '全量資料備份 (JSON)'}
        </button>
      </div>

      {/* Invite tokens */}
      {!isDemo && (
        <div className="card">
          <div className="card-head">
            <div className="card-head-left">
              <div className="card-icon accent"><I.Edit width={14} height={14} /></div>
              <div>
                <div className="card-kicker">Enrollment</div>
                <div className="card-title">產生收案邀請碼</div>
              </div>
            </div>
          </div>
          <div className="btn-row" style={{ marginBottom: 10 }}>
            <select className="input" value={invitePrefix}
              onChange={(e) => setInvitePrefix(e.target.value)}
              style={{ appearance: 'auto' }}>
              {SURGEON_PREFIXES.map(p => (
                <option key={p} value={p}>{SURGEON_NAMES[p]}（{p}）</option>
              ))}
            </select>
            <input className="input" type="text" inputMode="numeric" placeholder="編號 001"
              value={inviteNum}
              onChange={(e) => setInviteNum(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </div>
          {invitePrefix && inviteNum && (
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
              將建立 → <strong style={{ color: 'var(--accent)' }}>{invitePrefix}-{inviteNum.padStart(3, '0')}</strong>
            </div>
          )}
          <button className="btn btn-primary" onClick={handleCreateInvite} disabled={inviteCreating}>
            {inviteCreating ? '建立中…' : <>產生邀請碼 <I.Chevron width={14} height={14} /></>}
          </button>

          {inviteError && (
            <div className="alert-banner danger" style={{ marginTop: 10 }}>
              <div className="al-icon"><I.Alert width={18} height={18} /></div>
              <div><div className="al-msg">{inviteError}</div></div>
            </div>
          )}
          {inviteResult && (
            <div style={{
              marginTop: 12, padding: 12,
              background: 'var(--ok-soft)', border: '1px solid var(--ok)',
              borderRadius: 10,
            }}>
              <div style={{ fontSize: 11, color: 'var(--ok)', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', marginBottom: 6, textTransform: 'uppercase' }}>
                ✓ 已建立 · {inviteResult.study_id}
              </div>
              <div style={{
                display: 'flex', gap: 6, alignItems: 'center',
                padding: 10, background: 'var(--surface)', borderRadius: 6,
                fontFamily: 'var(--font-mono)', fontSize: 13, wordBreak: 'break-all',
              }}>
                <span style={{ flex: 1, color: 'var(--ink)' }}>{inviteResult.invite_token}</span>
                <button type="button"
                  onClick={() => copyToken(inviteResult.invite_token)}
                  style={{
                    background: 'var(--surface-2)', border: '1px solid var(--line)',
                    borderRadius: 6, padding: '4px 10px', fontSize: 11,
                    fontFamily: 'var(--font-mono)', cursor: 'pointer', color: 'var(--ink)',
                    flexShrink: 0,
                  }}>複製</button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
                到期：{new Date(inviteResult.expires_at).toLocaleDateString('zh-TW')}
              </div>
            </div>
          )}

          {recentInvites.length > 0 && (
            <>
              <div className="card-kicker" style={{ marginTop: 14, marginBottom: 6 }}>
                RECENT · {recentInvites.length}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recentInvites.map(inv => (
                  <div key={inv.invite_token} style={{
                    display: 'grid', gridTemplateColumns: 'auto 1fr auto',
                    alignItems: 'center', gap: 8,
                    padding: '8px 10px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    fontFamily: 'var(--font-mono)', fontSize: 11,
                  }}>
                    <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{inv.study_id}</span>
                    <span className={`chip chip-${inv.status === 'used' ? 'ok' : inv.status === 'pending' ? 'warn' : 'danger'}`}
                      style={{ padding: '2px 8px', fontSize: 10, justifySelf: 'start' }}>
                      {inv.status === 'used' ? '已使用' : inv.status === 'pending' ? '待使用' : '已過期'}
                    </span>
                    <button type="button" onClick={() => copyToken(inv.invite_token)}
                      style={{
                        background: 'transparent', border: '1px solid var(--line)',
                        borderRadius: 4, padding: '2px 8px', fontSize: 10,
                        cursor: 'pointer', color: 'var(--ink-2)',
                      }}>複製 token</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Researcher / PI invite (PI-only) */}
      {!isDemo && userInfo?.role === 'pi' && (
        <div className="card">
          <div className="card-head">
            <div className="card-head-left">
              <div className="card-icon accent"><I.User width={14} height={14} /></div>
              <div>
                <div className="card-kicker">Team</div>
                <div className="card-title">新增研究人員</div>
              </div>
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12, lineHeight: 1.55 }}>
            當場建立帳號，把初始密碼當面或用 LINE 交給對方。不寄信，所以不會有信收不到或連結失效的問題。對方首次登入時，系統會要求他改成自己的密碼。
          </p>
          <div className="input-group">
            <label className="input-lbl">Email</label>
            <input className="input" type="email" placeholder="researcher@example.com"
              value={researcherEmail}
              onChange={(e) => setResearcherEmail(e.target.value)} />
          </div>
          <div className="input-group">
            <label className="input-lbl">姓名</label>
            <input className="input" type="text" placeholder="研究助理 / 醫師姓名"
              value={researcherName}
              onChange={(e) => setResearcherName(e.target.value)} />
          </div>
          <div className="input-group">
            <label className="input-lbl">角色</label>
            <div className="role-toggle">
              <button type="button"
                className={researcherRole === 'researcher' ? 'on' : ''}
                onClick={() => setResearcherRole('researcher')}>
                <I.Chart width={12} height={12} /> 研究人員
              </button>
              <button type="button"
                className={researcherRole === 'pi' ? 'on' : ''}
                onClick={() => setResearcherRole('pi')}>
                <I.Shield width={12} height={12} /> 主持人 (PI)
              </button>
            </div>
          </div>
          <div className="input-group">
            <label className="input-lbl">
              所屬主刀醫師
              {researcherRole === 'pi' && <span style={{ color: 'var(--ink-3)', textTransform: 'none', letterSpacing: 0 }}> (選填)</span>}
            </label>
            <select className="input" style={{ appearance: 'auto' }}
              value={researcherSurgeon}
              onChange={(e) => setResearcherSurgeon(e.target.value)}>
              {researcherRole === 'pi' && <option value="">不綁定</option>}
              {SURGEON_PREFIXES.map(p => (
                <option key={p} value={p}>{SURGEON_NAMES[p]}（{p}）</option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
              {researcherRole === 'researcher'
                ? '此人只會看到所選醫師的病人'
                : 'PI 不受限制；設定只影響手術紀錄的著作歸屬'}
            </div>
          </div>
          <div className="input-group">
            <label className="input-lbl">初始密碼</label>
            <input className="input" type="text" placeholder="至少 8 個字元"
              value={researcherPassword}
              autoComplete="off"
              onChange={(e) => setResearcherPassword(e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
              明碼顯示，方便你唸給對方聽；他登入後必須改掉
            </div>
          </div>
          <button className="btn btn-primary" onClick={handleInviteResearcher} disabled={researcherInviting}>
            {researcherInviting ? '建立中…' : <>建立帳號 <I.Chevron width={14} height={14} /></>}
          </button>

          {researcherError && (
            <div className="alert-banner danger" style={{ marginTop: 10 }}>
              <div className="al-icon"><I.Alert width={18} height={18} /></div>
              <div><div className="al-msg">{researcherError}</div></div>
            </div>
          )}
          {researcherResult && (
            <div style={{
              marginTop: 12, padding: 12,
              background: 'var(--ok-soft)', border: '1px solid var(--ok)',
              borderRadius: 10,
              fontSize: 12.5, color: 'var(--ok)', fontFamily: 'var(--font-mono)',
              letterSpacing: '0.04em',
            }}>
              {researcherResult}
            </div>
          )}
        </div>
      )}

      {/* Team list (PI-only) */}
      {!isDemo && userInfo?.role === 'pi' && (
        <div className="card">
          <div className="card-head">
            <div className="card-head-left">
              <div className="card-icon"><I.User width={14} height={14} /></div>
              <div>
                <div className="card-kicker">Team · {teamList.length}</div>
                <div className="card-title">研究團隊名單</div>
              </div>
            </div>
            <button type="button" className="icon-btn" onClick={loadTeam}
              disabled={teamLoading} aria-label="重新載入">
              <I.Refresh width={14} height={14} />
            </button>
          </div>

          {teamError && (
            <div className="alert-banner danger" style={{ marginBottom: 10 }}>
              <div className="al-icon"><I.Alert width={18} height={18} /></div>
              <div><div className="al-msg">{teamError}</div></div>
            </div>
          )}

          {teamNotice && (
            <div className="alert-banner success" style={{ marginBottom: 10 }}>
              <div className="al-icon"><I.Check width={18} height={18} /></div>
              <div><div className="al-msg">{teamNotice}</div></div>
            </div>
          )}

          {teamLoading && teamList.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', padding: '10px 0', fontFamily: 'var(--font-mono)' }}>
              載入中…
            </p>
          )}

          {!teamLoading && teamList.length === 0 && !teamError && (
            <p style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', padding: '10px 0' }}>
              尚無研究人員
            </p>
          )}

          {teamList.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {teamList.map((u) => {
                const isBanned = !!u.banned_until && new Date(u.banned_until) > new Date();
                const isSelf = u.id === (userInfo?.id || null);
                const roleLabel = u.role === 'pi' ? '主持人' : '研究人員';
                return (
                  <div key={u.id} style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    alignItems: 'center', gap: 10,
                    padding: '10px 12px',
                    background: isBanned ? 'var(--surface-sunk)' : 'var(--surface-2)',
                    border: '1px solid var(--line)',
                    borderLeft: isBanned ? '3px solid var(--danger)' : (u.role === 'pi' ? '3px solid var(--accent)' : '1px solid var(--line)'),
                    borderRadius: 8,
                    opacity: isBanned ? 0.7 : 1,
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {u.display_name || '(未命名)'}
                        </span>
                        <span className={`chip ${u.role === 'pi' ? 'chip-warn' : 'chip-ok'}`}
                          style={{ padding: '1px 7px', fontSize: 9.5, fontFamily: 'var(--font-mono)' }}>
                          {roleLabel}
                        </span>
                        {u.surgeon_id && (
                          <span className="chip"
                            style={{ padding: '1px 7px', fontSize: 9.5, fontFamily: 'var(--font-mono)', background: 'var(--surface)', color: 'var(--ink-2)' }}>
                            {u.surgeon_id}
                          </span>
                        )}
                        {isBanned && (
                          <span className="chip chip-danger" style={{ padding: '1px 7px', fontSize: 9.5, fontFamily: 'var(--font-mono)' }}>
                            已停用
                          </span>
                        )}
                        {!u.last_sign_in_at && !isBanned && (
                          <span className="chip chip-warn" style={{ padding: '1px 7px', fontSize: 9.5, fontFamily: 'var(--font-mono)' }}>
                            未啟用
                          </span>
                        )}
                      </div>
                      <div style={{
                        fontSize: 11, color: 'var(--ink-3)',
                        fontFamily: 'var(--font-mono)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {u.email}
                      </div>
                      {u.last_sign_in_at && (
                        <div style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                          last: {new Date(u.last_sign_in_at).toLocaleDateString('zh-TW')}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {/* Not gated on last_sign_in_at any more. The accounts
                          most likely to need this signed in exactly once, off an
                          invite link, and never learned a password they could
                          use again — hiding the button from them left the PI
                          with no repair tool at all. */}
                      {!isSelf && !isBanned && (
                        <button type="button"
                          aria-label={`重設${u.display_name || u.email}的初始密碼`}
                          onClick={() => resetInitialPassword(u)}
                          disabled={resettingId === u.id}
                          style={{
                            background: 'var(--accent-soft)', border: '1px solid var(--accent)',
                            color: 'var(--accent)', borderRadius: 6, padding: '4px 10px',
                            fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)',
                            whiteSpace: 'nowrap',
                          }}>
                          {resettingId === u.id ? '重設中…' : '重設密碼'}
                        </button>
                      )}
                      {!isSelf && (
                        <button type="button"
                          onClick={() => toggleBan(u)}
                          disabled={banningId === u.id}
                          style={{
                            background: isBanned ? 'var(--ok-soft)' : 'var(--danger-soft)',
                            border: `1px solid ${isBanned ? 'var(--ok)' : 'var(--danger)'}`,
                            color: isBanned ? 'var(--ok)' : 'var(--danger)',
                            borderRadius: 6, padding: '4px 10px',
                            fontSize: 11, cursor: 'pointer',
                            fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
                            whiteSpace: 'nowrap',
                          }}>
                          {banningId === u.id ? '處理中…' : (isBanned ? '啟用' : '停用')}
                        </button>
                      )}
                      {isSelf && (
                        <span style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                          （你）
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {allReports.length > 0 && (
        <ResearcherCharts reports={allReports} patients={studyPatients} adherence={studyAdherence} />
      )}

      {/* Cohort */}
      <div className="card-kicker" style={{ margin: '18px 4px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>COHORT · {patientRows.length} PATIENTS</span>
        {surgeonIds.length > 1 && (
          <select value={surgeonFilter} onChange={(e) => setSurgeonFilter(e.target.value)}
            style={{
              background: 'var(--surface-2)', border: '1px solid var(--line)',
              borderRadius: 6, color: 'var(--ink)',
              fontSize: 10.5, padding: '3px 8px', fontFamily: 'var(--font-mono)',
              letterSpacing: '0.06em',
            }}>
            <option value="all">ALL</option>
            {surgeonIds.map(id => (
              <option key={id} value={id}>{SURGEON_NAMES[id] || id}</option>
            ))}
          </select>
        )}
      </div>

      <div className="cohort-list">
        {patientRows.map(row => {
          const tone = statusTone(row);
          const podLabel = row._pod === null ? '—' : row._pod === 0 ? 'OP' : `POD ${row._pod}`;
          const closeBadge = closeOutBadge(row._close);
          return (
            <div key={row.study_id} className="cohort-row" data-tone={tone}
              role={!isDemo ? 'button' : undefined}
              tabIndex={!isDemo ? 0 : undefined}
              aria-label={!isDemo ? `檢視 ${row.study_id} 病人詳情` : undefined}
              style={{ cursor: !isDemo ? 'pointer' : undefined }}
              onClick={!isDemo ? () => navigate(`/lookup/${row.study_id}`) : undefined}
              onKeyDown={!isDemo ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/lookup/${row.study_id}`); } } : undefined}
            >
              <div className="cr-id">{row.study_id}</div>
              <div className="cr-meta">
                <span>{podLabel}</span>
                <span>·</span>
                <span>{SURGEON_NAMES[row._surgeonId] || row._surgeonId || '—'}</span>
                {closeBadge && (
                  <>
                    <span>·</span>
                    <span style={{ color: `var(--${closeBadge.tone})`, fontWeight: 600 }}>
                      {closeBadge.text}
                    </span>
                  </>
                )}
              </div>
              <div className="cr-pain">
                <div className="cr-pain-num">{row.avg_pain ?? '—'}</div>
                <div className="cr-pain-lbl">AVG</div>
              </div>
              <div className={`chip chip-${tone || 'ok'}`}>{statusLabel(row)}</div>
              <div className="cr-last">{row.adherence_pct ?? 0}%</div>
              {!isDemo && (
                <button type="button"
                  onClick={(e) => { e.stopPropagation(); navigate(`/surgical-record/${row.study_id}`); }}
                  aria-label={`撰寫 ${row.study_id} 手術紀錄`}
                  title="撰寫手術紀錄"
                  style={{
                    gridColumn: '1 / -1',
                    marginTop: 2,
                    padding: '6px 10px',
                    fontSize: 11,
                    fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--line)',
                    borderRadius: 6,
                    color: 'var(--ink-2)',
                    cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}>
                  <I.Edit width={12} height={12} /> 撰寫手術紀錄
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <>
          <div className="card-kicker" style={{ margin: '18px 4px 10px' }}>
            ALERT HISTORY · {alerts.filter(a => !a.acknowledged).length} UNACKED
          </div>
          {alerts.map(a => (
            <div key={a.id} className={`alert-banner ${a.alert_level === 'danger' ? 'danger' : ''}`} style={{ position: 'relative' }}>
              <div className="al-icon"><I.Alert width={18} height={18} /></div>
              <div style={{ flex: 1 }}>
                <div className="al-title">{a.study_id} — {a.alert_type}</div>
                <div className="al-msg">{a.message}</div>
                <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                  {a.triggered_at} {a.acknowledged ? '· 已確認' : '· 未確認'}
                </div>
              </div>
              {!a.acknowledged && (
                <button
                  onClick={() => handleAcknowledge(a.id)}
                  disabled={ackingId === a.id}
                  style={{
                    background: 'var(--surface)', border: '1px solid var(--line)',
                    borderRadius: 6, color: 'var(--ok)',
                    fontSize: 11, padding: '4px 8px', cursor: 'pointer',
                    whiteSpace: 'nowrap', alignSelf: 'center',
                    fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
                  }}>
                  {ackingId === a.id ? '…' : '✓ 確認'}
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
