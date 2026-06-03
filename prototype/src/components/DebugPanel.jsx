// Dev-only debug panel — shows session / patient / data diagnostics
// Helps identify PWA vs web inconsistencies at a glance

import { useState, useEffect } from 'react';
import supabase from '../utils/supabaseClient';
import * as sb from '../utils/supabaseService';

const IS_DEV = import.meta.env.DEV;

export default function DebugPanel({ userInfo, isDemo }) {
  const [open, setOpen] = useState(false);
  const [diag, setDiag] = useState(null);

  useEffect(() => {
    if (!open || isDemo) return;
    let cancelled = false;

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        const studyId = userInfo?.studyId;
        let patientResult = null;
        let patientError = null;
        if (studyId) {
          const { data, error } = await supabase
            .from('patients')
            .select('*')
            .eq('study_id', studyId)
            .single();
          patientResult = data;
          patientError = error;
        }

        let todayReport = null;
        let todayReportError = null;
        if (studyId) {
          try {
            todayReport = await sb.getTodayReport(studyId);
          } catch (e) {
            todayReportError = e;
          }
        }

        let allReportsCount = null;
        if (studyId) {
          const reports = await sb.getAllReports(studyId);
          allReportsCount = reports.length;
        }

        if (!cancelled) {
          setDiag({
            // Session layer
            sessionExists: !!session,
            sessionEmail: session?.user?.email ?? '(none)',
            sessionUserId: session?.user?.id ?? '(none)',
            sessionRole: session?.user?.user_metadata?.role ?? '(none)',
            sessionStudyId: session?.user?.user_metadata?.study_id ?? '(none)',
            // getUser layer (server-verified)
            getUserEmail: user?.email ?? '(none)',
            getUserRole: user?.user_metadata?.role ?? '(none)',
            getUserStudyId: user?.user_metadata?.study_id ?? '(none)',
            getUserError: userError?.message ?? null,
            // App state layer
            userInfoStudyId: userInfo?.studyId ?? '(none)',
            userInfoRole: userInfo?.role ?? '(none)',
            userInfoSurgeryDate: userInfo?.surgeryDate ?? '(none)',
            userInfoPod: userInfo?.pod ?? '(none)',
            // Patient row
            patientFound: !!patientResult,
            patientSurgeryDate: patientResult?.surgery_date ?? '(none)',
            patientStudyStatus: patientResult?.study_status ?? '(none)',
            patientError: patientError ? `${patientError.code}: ${patientError.message}` : null,
            // Reports
            todayReportExists: !!todayReport,
            todayReportPain: todayReport?.pain_nrs ?? '(none)',
            todayReportError: todayReportError?.message ?? null,
            allReportsCount: allReportsCount ?? '(unknown)',
            // Meta
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            isStandalone: window.matchMedia('(display-mode: standalone)').matches,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setDiag({ error: err.message });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [open, isDemo, userInfo]);

  if (!IS_DEV) return null;

  const style = {
    panel: {
      margin: 'var(--space-md) 0',
      border: '1px dashed var(--warning)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-sm)',
      background: 'var(--warning-dim)',
      fontSize: '11px',
      fontFamily: 'monospace',
      lineHeight: 1.6,
    },
    toggle: {
      background: 'none',
      border: 'none',
      color: 'var(--warning)',
      cursor: 'pointer',
      fontSize: '11px',
      fontFamily: 'monospace',
      padding: '4px 0',
    },
    row: {
      display: 'flex',
      justifyContent: 'space-between',
      borderBottom: '1px dotted var(--border)',
      padding: '2px 0',
    },
    label: { color: 'var(--text-muted)' },
    value: { color: 'var(--text-primary)', textAlign: 'right', maxWidth: '60%', wordBreak: 'break-all' },
    mismatch: { color: 'var(--danger)', fontWeight: 'bold' },
  };

  const renderRow = (label, value, warn) => (
    <div style={style.row}>
      <span style={style.label}>{label}</span>
      <span style={warn ? style.mismatch : style.value}>{String(value)}</span>
    </div>
  );

  if (isDemo) {
    return (
      <div style={style.panel}>
        <span style={{ color: 'var(--warning)' }}>🔧 Debug: Demo mode</span>
      </div>
    );
  }

  return (
    <div style={style.panel}>
      <button style={style.toggle} onClick={() => setOpen(o => !o)}>
        🔧 Debug Panel {open ? '▲' : '▼'}
      </button>
      {open && diag && (
        <>
          <div style={{ marginTop: '4px', marginBottom: '4px', color: 'var(--warning)', fontWeight: 'bold' }}>
            — Session —
          </div>
          {renderRow("email", diag.sessionEmail)}
          {renderRow("user_id", diag.sessionUserId)}
          {renderRow("session.role", diag.sessionRole)}
          {renderRow("session.study_id", diag.sessionStudyId, diag.sessionStudyId !== diag.userInfoStudyId)}
          {renderRow("getUser.study_id", diag.getUserStudyId, diag.getUserStudyId !== diag.sessionStudyId)}
          {diag.getUserError && renderRow("getUser error", diag.getUserError, true)}

          <div style={{ marginTop: '4px', marginBottom: '4px', color: 'var(--warning)', fontWeight: 'bold' }}>
            — App State —
          </div>
          {renderRow("userInfo.studyId", diag.userInfoStudyId)}
          {renderRow("userInfo.role", diag.userInfoRole)}
          {renderRow("userInfo.surgeryDate", diag.userInfoSurgeryDate)}
          {renderRow("userInfo.pod", diag.userInfoPod)}

          <div style={{ marginTop: '4px', marginBottom: '4px', color: 'var(--warning)', fontWeight: 'bold' }}>
            — Patient Row —
          </div>
          {renderRow("found", diag.patientFound, !diag.patientFound)}
          {renderRow("surgery_date", diag.patientSurgeryDate, diag.patientFound && diag.patientSurgeryDate !== diag.userInfoSurgeryDate)}
          {renderRow("study_status", diag.patientStudyStatus)}
          {diag.patientError && renderRow("patient error", diag.patientError, true)}

          <div style={{ marginTop: '4px', marginBottom: '4px', color: 'var(--warning)', fontWeight: 'bold' }}>
            — Reports —
          </div>
          {renderRow("today report", diag.todayReportExists ? `yes (pain=${diag.todayReportPain})` : 'no')}
          {diag.todayReportError && renderRow("today error", diag.todayReportError, true)}
          {renderRow("total reports", diag.allReportsCount)}

          <div style={{ marginTop: '4px', marginBottom: '4px', color: 'var(--warning)', fontWeight: 'bold' }}>
            — Environment —
          </div>
          {renderRow("standalone (PWA)", diag.isStandalone)}
          {renderRow("timestamp", diag.timestamp)}
        </>
      )}
      {open && !diag && <div style={{ color: 'var(--text-muted)' }}>Loading...</div>}
    </div>
  );
}
