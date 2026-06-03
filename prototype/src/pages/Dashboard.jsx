import { useEffect } from 'react';
import { useDashboardData } from '../utils/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { markNotificationRead } from '../utils/supabaseService';
import { isWoundNormal, formatWound } from '../utils/schemaContract';
import NotificationSetup from '../components/NotificationSetup';
import DebugPanel from '../components/DebugPanel';
import * as I from '../components/Icons';

const PAIN_TONE = (v) => v == null ? '' : v <= 3 ? 'ok' : v <= 6 ? 'warn' : 'danger';
const PAIN_WORD = (v) => v == null ? '—' : v === 0 ? '無痛' : v <= 3 ? '輕度' : v <= 6 ? '中度' : v <= 8 ? '嚴重' : '劇烈';

const PHASE = (pod) => pod === 0 ? '手術當日' : pod <= 3 ? '急性期' : pod <= 7 ? '早期恢復' : pod <= 14 ? '中期恢復' : '後期追蹤';

export default function Dashboard({ onNavigate, isDemo, userInfo, onLogout, onSyncSurgeryDate }) {
  const { data, isLoading, error, refetch, isFetching } = useDashboardData(isDemo, userInfo);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (data?.surgeryDate && onSyncSurgeryDate) {
      onSyncSurgeryDate(data.surgeryDate);
    }
  }, [data?.surgeryDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSync = async () => {
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    await queryClient.invalidateQueries({ queryKey: ['history'] });
    refetch();
  };

  if (isLoading) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <p style={{ color: 'var(--ink-2)', animation: 'pulse 1s infinite', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>載入中…</p>
      </div>
    );
  }

  if (error) {
    const isMissingPatient = error.message?.includes('MISSING_PATIENT') || error.message?.includes('MISSING_SURGERY_DATE');
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', maxWidth: 320 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--danger-soft)', color: 'var(--danger)',
            display: 'grid', placeItems: 'center', margin: '0 auto var(--space-md)',
          }}>
            <I.Alert width={24} height={24} />
          </div>
          <h2 className="page-title" style={{ fontSize: 18, marginBottom: 4 }}>
            {isMissingPatient ? '尚未完成病人資料同步' : '載入失敗'}
          </h2>
          <p style={{ color: 'var(--ink-2)', fontSize: 12.5, marginBottom: 'var(--space-md)' }}>
            {isMissingPatient ? '請重新登入或聯絡研究團隊。' : error.message}
          </p>
          <button className="btn btn-secondary" onClick={onLogout}>重新登入</button>
          <div style={{
            marginTop: 'var(--space-lg)', padding: 10, borderRadius: 8,
            background: 'var(--surface-2)', border: '1px solid var(--line)',
            fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)',
            textAlign: 'left', lineHeight: 1.6, wordBreak: 'break-all',
          }}>
            <div>study_id: {userInfo?.studyId || '(null)'}</div>
            <div>role: {userInfo?.role || '(null)'}</div>
            <div>surgeryDate: {userInfo?.surgeryDate || '(null)'}</div>
            <div>error: {error.message?.substring(0, 120)}</div>
          </div>
          <DebugPanel userInfo={userInfo} isDemo={isDemo} />
        </div>
      </div>
    );
  }

  const { pod, surgeryDate, todayReport, allReports, alerts, adherence, surveyDone, pendingNotifs } = data;
  const latestPain = allReports.length > 0 ? (allReports[0]?.pain_nrs ?? allReports[0]?.pain ?? null) : null;
  const todayPain = todayReport?.pain_nrs ?? todayReport?.pain ?? null;
  const todayBleeding = todayReport?.bleeding;
  const todayBowel = todayReport?.bowel;
  const todayFever = todayReport?.fever;
  const todayWound = todayReport?.wound;
  const todayUrinary = todayReport?.urinary;
  const todayContinence = todayReport?.continence;

  return (
    <div className="page">
      {/* Topbar */}
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <img src="/KSVGH.png" alt="KSVGH" />
          </div>
          <div className="brand-text">
            <div className="hospital">KSVGH · CRS{isDemo && ' · DEMO'}</div>
            <div className="system">術後追蹤系統</div>
          </div>
        </div>
        <button className="icon-btn" onClick={onLogout} aria-label="登出">
          <I.LogOut width={17} height={17} />
        </button>
      </div>

      {/* POD hero */}
      <div className="pod-hero">
        <div className="pod-hero-row">
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>術後天數 · POST-OP DAY</div>
            <div className="pod-number">{pod === 0 ? 'OP' : pod}</div>
          </div>
          <div className="pod-meta">
            <div className="pod-meta-lbl">Surgery Date</div>
            <div className="pod-meta-val">{surgeryDate}</div>
            <div style={{ marginTop: 10 }}>
              <span className="pod-phase-tag">
                <I.Sparkle width={11} height={11} />
                {PHASE(pod)}
              </span>
            </div>
          </div>
        </div>
        <div className="pod-ruler">
          {Array.from({ length: 14 }).map((_, i) => {
            const cls = i < pod ? 'filled' : i === pod ? 'today' : '';
            return <span key={i} className={cls} />;
          })}
        </div>
        <div className="pod-caption">
          <I.Info width={14} height={14} />
          <span>每日回報幫助醫療團隊掌握您的恢復狀況</span>
        </div>
      </div>

      {/* Survey prompt */}
      {pod >= 14 && !surveyDone && (
        <div className="card">
          <div className="card-head">
            <div className="card-head-left">
              <div className="card-icon accent"><I.Edit width={14} height={14} /></div>
              <div>
                <div className="card-kicker">Usability</div>
                <div className="card-title">系統可用性問卷</div>
              </div>
            </div>
            <span className="badge pending">待填寫</span>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-2)', marginBottom: 12, lineHeight: 1.55 }}>
            您已使用系統超過 14 天，請花 1 分鐘填寫可用性問卷，幫助我們改善系統。
          </p>
          <button className="btn btn-primary" onClick={() => onNavigate('survey')}>
            填寫問卷 <I.Chevron width={14} height={14} />
          </button>
        </div>
      )}
      {pod >= 14 && surveyDone && (
        <div className="card sunk" style={{ opacity: 0.8 }}>
          <div className="card-head" style={{ marginBottom: 0 }}>
            <div className="card-head-left">
              <div className="card-icon ok"><I.Check width={14} height={14} /></div>
              <div className="card-title">系統可用性問卷</div>
            </div>
            <span className="badge done">已完成</span>
          </div>
        </div>
      )}

      {/* Pending notifications */}
      {pendingNotifs && pendingNotifs.length > 0 && pendingNotifs.map(n => (
        <div key={n.id} className="alert-banner warning" style={{ position: 'relative' }}>
          <div className="al-icon"><I.Bell width={18} height={18} /></div>
          <div>
            <div className="al-title">{n.title}</div>
            <div className="al-msg">{n.message}</div>
            <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
              {new Date(n.created_at).toLocaleString('zh-TW')}
            </div>
          </div>
          <button
            onClick={async () => { await markNotificationRead(n.id); refetch(); }}
            style={{
              position: 'absolute', top: 8, right: 8,
              background: 'none', border: 'none', color: 'var(--ink-3)',
              cursor: 'pointer', padding: 4,
            }}
            aria-label="dismiss"
          ><I.Close width={14} height={14} /></button>
        </div>
      ))}

      {/* Alerts */}
      {alerts.map(alert => (
        <div key={alert.id} className={`alert-banner ${alert.type === 'warning' ? '' : alert.type}`}>
          <div className="al-icon"><I.Alert width={18} height={18} /></div>
          <div>
            <div className="al-title">{alert.title}</div>
            <div className="al-msg">{alert.message}</div>
          </div>
        </div>
      ))}

      {/* Today's report */}
      <div className="card">
        <div className="card-head">
          <div className="card-head-left">
            <div className="card-icon"><I.Clipboard width={14} height={14} /></div>
            <div>
              <div className="card-kicker">Today · 今日回報</div>
              <div className="card-title">{todayReport ? '已完成今日回報' : '尚未填寫今日回報'}</div>
            </div>
          </div>
          <span className={`badge ${todayReport ? 'done' : 'pending'}`}>
            {todayReport ? '已完成' : '待填寫'}
          </span>
        </div>

        {!todayReport ? (
          <button className="btn btn-primary" onClick={() => onNavigate('report')}>
            填寫今日症狀回報 <I.Chevron width={16} height={16} />
          </button>
        ) : (
          <>
            <div className="sym-list">
              <div className="sym-row">
                <span className="sym-name">疼痛分數</span>
                <span className={`sym-val ${PAIN_TONE(todayPain)}`}>{todayPain}<span className="unit">/10</span></span>
              </div>
              <div className="sym-row">
                <span className="sym-name">出血</span>
                <span className={`sym-val ${todayBleeding === '持續' || todayBleeding === '血塊' ? 'danger' : todayBleeding === '少量' ? 'warn' : 'ok'}`}>
                  {todayBleeding}
                </span>
              </div>
              <div className="sym-row">
                <span className="sym-name">排便</span>
                <span className={`sym-val ${todayBowel === '未排' ? 'warn' : 'ok'}`}>{todayBowel}</span>
              </div>
              <div className="sym-row">
                <span className="sym-name">發燒</span>
                <span className={`sym-val ${todayFever ? 'danger' : 'ok'}`}>{todayFever ? '是' : '否'}</span>
              </div>
              {todayWound && !isWoundNormal(todayWound) && (
                <div className="sym-row">
                  <span className="sym-name">傷口</span>
                  <span className="sym-val warn">{formatWound(todayWound)}</span>
                </div>
              )}
              {todayUrinary && todayUrinary !== '正常' && (
                <div className="sym-row">
                  <span className="sym-name">排尿</span>
                  <span className={`sym-val ${todayUrinary === '尿不出來' ? 'danger' : 'warn'}`}>{todayUrinary}</span>
                </div>
              )}
              {todayContinence && todayContinence !== '正常' && (
                <div className="sym-row">
                  <span className="sym-name">控便</span>
                  <span className={`sym-val ${todayContinence === '失禁' ? 'danger' : 'warn'}`}>{todayContinence}</span>
                </div>
              )}
            </div>
            <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => onNavigate('report')}>
              <I.Edit width={14} height={14} /> 修改今日回報
            </button>
          </>
        )}
      </div>

      {/* Stats */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-lbl">Adherence · 回報率</div>
          <div className="stat-val">{adherence}<span className="sub">%</span></div>
          <div className={`stat-foot ${adherence >= 90 ? 'ok' : 'warn'}`}>
            {adherence >= 90 ? '優於同期' : '可再努力'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-lbl">Latest Pain · 最新疼痛</div>
          <div className="stat-val" style={{ color: latestPain != null ? `var(--${PAIN_TONE(latestPain) === 'ok' ? 'ok' : PAIN_TONE(latestPain) === 'warn' ? 'warn' : 'danger'})` : 'var(--ink-3)' }}>
            {latestPain != null ? latestPain : '—'}<span className="sub">{latestPain != null ? '/10' : ''}</span>
          </div>
          <div className={`stat-foot ${PAIN_TONE(latestPain)}`}>{PAIN_WORD(latestPain)}</div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="card">
        <div className="card-head">
          <div className="card-head-left">
            <div className="card-icon"><I.Sparkle width={14} height={14} /></div>
            <div className="card-title">快捷功能</div>
          </div>
        </div>
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={() => onNavigate('history')}>
            <I.Chart width={14} height={14} /> 歷史紀錄
          </button>
          <button className="btn btn-secondary" onClick={() => onNavigate('chat')}>
            <I.Message width={14} height={14} /> AI 衛教
          </button>
        </div>
        <button className="btn btn-ghost" style={{ marginTop: 8 }}
          onClick={handleSync} disabled={isFetching}>
          <I.Refresh width={14} height={14} /> {isFetching ? '同步中…' : '重新同步資料'}
        </button>
      </div>

      <NotificationSetup studyId={userInfo?.studyId} isDemo={isDemo} />
      <DebugPanel userInfo={userInfo} isDemo={isDemo} />
    </div>
  );
}
