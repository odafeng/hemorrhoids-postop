import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as sb from '../utils/supabaseService';
import * as I from '../components/Icons';
import { isWoundNormal, formatWound } from '../utils/schemaContract';

export default function ResearcherPatientLookup({ onNavigate, isDemo }) {
  const navigate = useNavigate();
  const { studyId: routeStudyId } = useParams();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [resetEmail, setResetEmail] = useState('');
  const [resetPwd, setResetPwd] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMsg, setResetMsg] = useState('');
  const [showResetPwd, setShowResetPwd] = useState(false);

  // Healthcare-utilisation entry state
  const [hcuType, setHcuType] = useState('門診');
  const [hcuDate, setHcuDate] = useState('');
  const [hcuReason, setHcuReason] = useState('');
  const [hcuSaving, setHcuSaving] = useState(false);
  const [hcuMsg, setHcuMsg] = useState('');

  // Signature viewing state
  const [sigUrl, setSigUrl] = useState(null);
  const [sigLoading, setSigLoading] = useState(false);
  const [sigError, setSigError] = useState('');

  const handleViewSignature = async () => {
    setSigError(''); setSigUrl(null);
    if (!result?.patient?.consent_signature_url) return;
    setSigLoading(true);
    try {
      const url = await sb.getSignedSignatureUrl(result.patient.consent_signature_url, 300);
      if (!url) throw new Error('無法取得簽名連結');
      setSigUrl(url);
    } catch (err) {
      setSigError(err.message || '載入失敗');
    } finally {
      setSigLoading(false);
    }
  };

  const closeSignature = () => { setSigUrl(null); setSigError(''); };

  const runLookup = async (studyId) => {
    if (!studyId) return;
    setLoading(true); setError(''); setResult(null); setSigUrl(null); setSigError('');
    try {
      if (isDemo) {
        setResult({ demo: true, studyId });
        return;
      }
      const [patient, reports, alerts] = await Promise.all([
        sb.getPatient(studyId),
        sb.getAllReports(studyId),
        sb.getAlerts(studyId),
      ]);
      const today = new Date().toLocaleDateString('en-CA');
      const todayReport = reports.find(r => r.report_date === today) || null;
      const activeAlerts = alerts.filter(a => !a.acknowledged);
      const latestReport = reports.length > 0 ? reports[0] : null;
      const pod = patient?.surgery_date ? sb.getPODFromDate(patient.surgery_date) : null;
      setResult({
        studyId,
        patientExists: !!patient,
        patient,
        pod,
        reports,                       // ← 新增：整份逐日原始列
        totalReports: reports.length,
        latestReportDate: latestReport?.report_date || null,
        latestReportPain: latestReport?.pain_nrs ?? null,
        todayReported: !!todayReport,
        activeAlerts: activeAlerts.length,
        alertDetails: activeAlerts,
      });
    } catch (err) {
      setError(err.message || '查詢失敗');
    } finally {
      setLoading(false);
    }
  };

  const handleLookup = (e) => { e.preventDefault(); runLookup(query.trim()); };

  useEffect(() => {
    if (routeStudyId) { setQuery(routeStudyId); runLookup(routeStudyId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeStudyId]);

  return (
    <div className="page">
      <div className="topbar">
        <button className="icon-btn" onClick={() => onNavigate('researcherDashboard')} aria-label="返回">
          <I.ArrowLeft width={17} height={17} />
        </button>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)', letterSpacing: '0.1em' }}>
          PATIENT LOOKUP
        </div>
        <div style={{ width: 36 }} />
      </div>

      <div className="page-head">
        <div className="eyebrow">RESEARCHER TOOLS</div>
        <h1 className="page-title">病人查詢</h1>
        <p className="page-sub">輸入 Study ID 查詢病人資料與警示狀況</p>
      </div>

      <form onSubmit={handleLookup}>
        <div className="search-box">
          <I.Search width={14} height={14} />
          <input placeholder="搜尋病人編號 · e.g. HSF-003"
            value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? '查詢中…' : <>查詢 <I.Chevron width={14} height={14} /></>}
        </button>
      </form>

      {error && (
        <div className="alert-banner danger" style={{ marginTop: 12 }}>
          <div className="al-icon"><I.Alert width={18} height={18} /></div>
          <div><div className="al-msg">{error}</div></div>
        </div>
      )}

      {result?.demo && (
        <div className="card" style={{ marginTop: 12 }}>
          <p style={{ color: 'var(--ink-3)', textAlign: 'center', fontSize: 12.5 }}>
            Demo 模式不支援即時查詢
          </p>
        </div>
      )}

      {result && !result.demo && (
        <>
          <div className="card" style={{ marginTop: 12 }}>
            <div className="eyebrow small">CASE DETAIL</div>
            <div className="case-head">
              <div className="case-id">{result.studyId}</div>
              <div className={`chip chip-${result.activeAlerts > 0 ? 'danger' : result.patientExists ? 'ok' : 'warn'}`}>
                {!result.patientExists ? '未建檔' : result.activeAlerts > 0 ? '警示' : '穩定'}
              </div>
            </div>
            {result.patientExists && (
              <div className="case-grid">
                <div>
                  <div className="case-k">Study Status</div>
                  <div className="case-v">{result.patient.study_status || '—'}</div>
                </div>
                <div>
                  <div className="case-k">Surgery Date</div>
                  <div className="case-v">{result.patient.surgery_date || '—'}</div>
                </div>
                <div>
                  <div className="case-k">POD</div>
                  <div className="case-v">{result.pod ?? '—'}</div>
                </div>
                <div>
                  <div className="case-k">術式</div>
                  <div className="case-v">{result.patient.surgery_type || '—'}</div>
                </div>
                <div>
                  <div className="case-k">Total Reports</div>
                  <div className="case-v">{result.totalReports}</div>
                </div>
                <div>
                  <div className="case-k">Latest NRS</div>
                  <div className="case-v">{result.latestReportPain ?? '—'}</div>
                </div>
                <div>
                  <div className="case-k">Today</div>
                  <div className="case-v">{result.todayReported ? '✓ 已回報' : '✗ 未回報'}</div>
                </div>
                <div>
                  <div className="case-k">Active Alerts</div>
                  <div className="case-v" style={{ color: result.activeAlerts > 0 ? 'var(--danger)' : undefined }}>
                    {result.activeAlerts}
                  </div>
                </div>
              </div>
            )}

            {/* Operative record entry */}
            {result.patientExists && !isDemo && (
              <div style={{
                marginTop: 14, paddingTop: 12,
                borderTop: '1px solid var(--line)',
              }}>
                <button className="btn btn-primary"
                  onClick={() => navigate(`/surgical-record/${result.studyId}`)}>
                  <I.Edit width={14} height={14} /> 撰寫手術紀錄
                </button>
              </div>
            )}

            {/* Consent signature */}
            {result.patientExists && result.patient?.consent_signed && (
              <div style={{
                marginTop: 14, paddingTop: 12,
                borderTop: '1px solid var(--line)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              }}>
                <div>
                  <div className="case-k">Consent Signature</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                    簽署：{result.patient.consent_date ? new Date(result.patient.consent_date).toLocaleDateString('zh-TW') : '—'}
                  </div>
                </div>
                {result.patient.consent_signature_url ? (
                  <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 14px' }}
                    onClick={handleViewSignature} disabled={sigLoading}>
                    {sigLoading ? '載入中…' : <><I.Eye width={14} height={14} /> 檢視簽名</>}
                  </button>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                    （無簽名檔）
                  </span>
                )}
              </div>
            )}
          </div>

          {result.patientExists && result.reports.length > 0 && (
            <PatientPainTrend reports={result.reports} />
          )}

          {result.patientExists && (
            <>
              <div className="card-kicker" style={{ margin: '18px 4px 10px' }}>
                DAILY REPORTS · {result.reports.length}
              </div>
              {result.reports.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 12.5 }}>
                  尚無回報紀錄
                </div>
              ) : (
                result.reports.map((r) => {
                  const pain = r.pain_nrs;
                  const hasAlert = pain >= 8 || r.bleeding === '持續' || r.bleeding === '血塊' || r.fever || r.urinary === '尿不出來' || r.continence === '失禁';
                  const concerning = !hasAlert && pain >= 5;
                  const painTone = pain == null ? '' : pain <= 3 ? 'ok' : pain <= 6 ? 'warn' : 'danger';
                  return (
                    <div key={r.report_date} className={`tl-item ${hasAlert ? 'alert' : concerning ? 'warn' : 'ok'}`}>
                      <div className="tl-date">{r.pod != null ? `POD ${r.pod}` : '—'} · {r.report_date}</div>
                      <div className="card" style={{ marginBottom: 0 }}>
                        <div className="sym-list">
                          <div className="sym-row"><span className="sym-name">疼痛</span>
                            <span className={`sym-val ${painTone}`}>{pain}<span className="unit">/10</span></span></div>
                          <div className="sym-row"><span className="sym-name">出血</span>
                            <span className={`sym-val ${r.bleeding === '持續' || r.bleeding === '血塊' ? 'danger' : r.bleeding === '少量' ? 'warn' : 'ok'}`}>{r.bleeding}</span></div>
                          <div className="sym-row"><span className="sym-name">排便</span>
                            <span className={`sym-val ${r.bowel === '未排' || r.bowel === '困難' ? 'warn' : 'ok'}`}>{r.bowel}</span></div>
                          {r.fever && (
                            <div className="sym-row"><span className="sym-name">發燒</span>
                              <span className="sym-val danger">是</span></div>
                          )}
                          <div className="sym-row"><span className="sym-name">傷口</span>
                            <span className={`sym-val ${isWoundNormal(r.wound) ? 'ok' : 'warn'}`}>{formatWound(r.wound)}</span></div>
                          {r.urinary && r.urinary !== '正常' && (
                            <div className="sym-row"><span className="sym-name">排尿</span>
                              <span className={`sym-val ${r.urinary === '尿不出來' ? 'danger' : 'warn'}`}>{r.urinary}</span></div>
                          )}
                          {r.continence && r.continence !== '正常' && (
                            <div className="sym-row"><span className="sym-name">肛門控制</span>
                              <span className={`sym-val ${r.continence === '失禁' ? 'danger' : 'warn'}`}>{r.continence}</span></div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}

          {sigError && (
            <div className="alert-banner danger" style={{ marginTop: 10 }}>
              <div className="al-icon"><I.Alert width={18} height={18} /></div>
              <div><div className="al-msg">{sigError}</div></div>
            </div>
          )}

          {/* Signature modal */}
          {sigUrl && (
            <div
              onClick={closeSignature}
              style={{
                position: 'fixed', inset: 0, zIndex: 200,
                background: 'rgba(0,0,0,0.72)',
                display: 'grid', placeItems: 'center',
                padding: 20, animation: 'fadeIn 0.2s ease',
              }}>
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  maxWidth: '92vw', maxHeight: '92vh',
                  background: 'var(--surface)', border: '1px solid var(--line)',
                  borderRadius: 14, padding: 20,
                  display: 'flex', flexDirection: 'column', gap: 12,
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div className="card-kicker">Signature · {result.studyId}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                      連結 5 分鐘後過期
                    </div>
                  </div>
                  <button type="button" className="icon-btn" onClick={closeSignature} aria-label="關閉">
                    <I.Close width={16} height={16} />
                  </button>
                </div>
                <img
                  src={sigUrl}
                  alt={`${result.studyId} consent signature`}
                  style={{
                    background: '#fff', borderRadius: 8,
                    maxWidth: '100%', maxHeight: '70vh',
                    objectFit: 'contain', border: '1px solid var(--line)',
                  }}
                />
              </div>
            </div>
          )}

          {result.alertDetails?.length > 0 && (
            <>
              <div className="card-kicker" style={{ margin: '14px 4px 10px' }}>UNACKED ALERTS</div>
              {result.alertDetails.map(a => (
                <div key={a.id} className={`alert-banner ${a.alert_level === 'danger' ? 'danger' : ''}`}>
                  <div className="al-icon"><I.Alert width={18} height={18} /></div>
                  <div>
                    <div className="al-title">{a.alert_type}</div>
                    <div className="al-msg">{a.message}</div>
                    <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                      {a.triggered_at}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {!isDemo && result?.patient && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <div className="card-head-left">
              <div className="card-icon"><I.Clipboard width={14} height={14} /></div>
              <div>
                <div className="card-kicker">Data Entry</div>
                <div className="card-title">登錄就醫事件</div>
              </div>
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12, lineHeight: 1.55 }}>
            門診、急診、再住院與電話諮詢都在這裡登錄。POD 由就醫日期自動算出。
          </p>
          <div className="input-group">
            <label className="input-lbl" htmlFor="hcu-type">就醫類型</label>
            <select id="hcu-type" className="input" aria-label="就醫類型"
              value={hcuType} onChange={e => setHcuType(e.target.value)}>
              <option value="門診">門診</option>
              <option value="急診">急診</option>
              <option value="再住院">再住院</option>
              <option value="電話諮詢">電話諮詢</option>
            </select>
          </div>
          <div className="input-group">
            <label className="input-lbl" htmlFor="hcu-date">就醫日期</label>
            <input id="hcu-date" className="input" type="date" placeholder="就醫日期"
              value={hcuDate} onChange={e => setHcuDate(e.target.value)} />
          </div>
          <div className="input-group">
            <label className="input-lbl" htmlFor="hcu-reason">就醫原因</label>
            <input id="hcu-reason" className="input" type="text" placeholder="就醫原因（例：術後出血）"
              value={hcuReason} onChange={e => setHcuReason(e.target.value)} />
          </div>
          <button className="btn btn-primary"
            disabled={hcuSaving || !hcuDate || !hcuReason.trim()}
            onClick={async () => {
              setHcuSaving(true); setHcuMsg('');
              try {
                // Derived, never typed: a hand-entered POD drifts from the one
                // on the symptom reports and the two stop lining up.
                const pod = Math.floor(
                  (Date.parse(`${hcuDate}T00:00:00Z`)
                    - Date.parse(`${result.patient.surgery_date}T00:00:00Z`)) / 86400000
                );
                await sb.addUtilization({
                  studyId: result.studyId, eventType: hcuType,
                  eventDate: hcuDate, reason: hcuReason.trim(), podAtEvent: pod,
                });
                setHcuMsg(`✓ 已登錄（POD ${pod}）`);
                setHcuDate(''); setHcuReason('');
              } catch (err) {
                setHcuMsg('✗ ' + (err.message || '登錄失敗'));
              } finally {
                setHcuSaving(false);
              }
            }}>
            {hcuSaving ? '處理中…' : '登錄'}
          </button>
          {hcuMsg && (
            <div style={{
              marginTop: 10, fontSize: 12, textAlign: 'center',
              color: hcuMsg.startsWith('✓') ? 'var(--ok)' : 'var(--danger)',
              fontFamily: 'var(--font-mono)',
            }}>
              {hcuMsg}
            </div>
          )}
        </div>
      )}

      {!isDemo && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <div className="card-head-left">
              <div className="card-icon warn"><I.Shield width={14} height={14} /></div>
              <div>
                <div className="card-kicker">Admin Tool</div>
                <div className="card-title">重設病人密碼</div>
              </div>
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12, lineHeight: 1.55 }}>
            當病人忘記密碼時，研究人員可在此直接重設。
          </p>
          <div className="input-group">
            <label className="input-lbl">病人電子郵件</label>
            <input className="input" type="email" placeholder="patient@example.com"
              value={resetEmail} onChange={e => setResetEmail(e.target.value)} />
          </div>
          <div className="input-group">
            <label className="input-lbl">新密碼 <span style={{ color: 'var(--ink-3)', textTransform: 'none', letterSpacing: 0 }}>(至少 6 字元)</span></label>
            <div className="input-password-wrap">
              <input className="input"
                type={showResetPwd ? 'text' : 'password'}
                placeholder="輸入新密碼"
                value={resetPwd}
                onChange={e => setResetPwd(e.target.value)}
                minLength={6} />
              <button type="button" className="input-eye"
                onClick={() => setShowResetPwd(v => !v)}
                aria-label={showResetPwd ? '隱藏密碼' : '顯示密碼'}
                tabIndex={-1}>
                {showResetPwd ? <I.EyeOff width={18} height={18} /> : <I.Eye width={18} height={18} />}
              </button>
            </div>
          </div>
          <button className="btn btn-primary"
            disabled={resetLoading || !resetEmail.trim() || resetPwd.length < 6}
            onClick={async () => {
              setResetLoading(true); setResetMsg('');
              try {
                await sb.adminResetPassword(resetEmail.trim(), resetPwd);
                setResetMsg('✓ 密碼重設成功');
                setResetPwd('');
              } catch (err) {
                setResetMsg('✗ ' + (err.message || '重設失敗'));
              } finally {
                setResetLoading(false);
              }
            }}>
            {resetLoading ? '處理中…' : '重設密碼'}
          </button>
          {resetMsg && (
            <div style={{
              marginTop: 10, fontSize: 12, textAlign: 'center',
              color: resetMsg.startsWith('✓') ? 'var(--ok)' : 'var(--danger)',
              fontFamily: 'var(--font-mono)',
            }}>
              {resetMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PatientPainTrend({ reports }) {
  const [range, setRange] = useState(14);
  const asc = [...reports].map(r => ({ pain: r.pain_nrs, date: r.report_date, pod: r.pod }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const shown = range > 0 ? asc.slice(-range) : asc;
  if (shown.length === 0) return null;

  const W = 360, H = 140, padX = 26, padY = 18;
  const cW = W - padX * 2, cH = H - padY * 2;
  const pts = shown.map((r, i) => ({
    x: padX + (shown.length === 1 ? cW / 2 : (i / (shown.length - 1)) * cW),
    y: padY + cH - (r.pain / 10) * cH,
    pain: r.pain, date: r.date, pod: r.pod,
  }));
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <div className="card-kicker" style={{ marginBottom: 2 }}>PAIN NRS TREND</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>疼痛分數趨勢</div>
        </div>
        <div className="range-row">
          {[7, 14, 0].map((r) => (
            <button key={r} className={`range-chip ${range === r ? 'on' : ''}`} onClick={() => setRange(r)}>
              {r === 0 ? 'ALL' : `${r}D`}
            </button>
          ))}
        </div>
      </div>
      <div className="chart">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="painGradR" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 2, 4, 6, 8, 10].map((v) => {
            const y = padY + cH - (v / 10) * cH;
            return (
              <g key={v}>
                <line x1={padX} y1={y} x2={W - padX} y2={y} stroke="var(--chart-grid)" strokeWidth="1" strokeDasharray={v === 0 || v === 10 ? '' : '2 3'} />
                <text x={padX - 6} y={y + 3} fill="var(--ink-3)" fontSize="9" textAnchor="end" fontFamily="var(--font-mono)">{v}</text>
              </g>
            );
          })}
          {pts.length > 1 && (
            <>
              <path d={`${path} L ${pts[pts.length - 1].x} ${padY + cH} L ${pts[0].x} ${padY + cH} Z`} fill="url(#painGradR)" />
              <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}
          {pts.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="var(--surface)"
              stroke={p.pain >= 7 ? 'var(--danger)' : p.pain >= 4 ? 'var(--warn)' : 'var(--ok)'} strokeWidth="2" />
          ))}
          {pts.filter((_, i) => i === 0 || i === pts.length - 1 || i === Math.floor(pts.length / 2)).map((p, i) => (
            <text key={`pod-${i}`} x={p.x} y={H - 4} fill="var(--ink-3)" fontSize="9" textAnchor="middle" fontFamily="var(--font-mono)">
              {p.pod != null ? `POD ${p.pod}` : p.date.slice(5)}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}
