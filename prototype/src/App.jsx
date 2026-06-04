import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, NavLink } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import SymptomReport from './pages/SymptomReport';
import History from './pages/History';
import AIChat from './pages/AIChat';
import UsabilitySurvey from './pages/UsabilitySurvey';
import ResearcherDashboard from './pages/ResearcherDashboard';
import ResearcherPatientLookup from './pages/ResearcherPatientLookup';
import ChatReview from './pages/ChatReview';
import OfflineBanner from './components/OfflineBanner';
import IOSInstallPrompt from './components/IOSInstallPrompt';
import UpdateBanner from './components/UpdateBanner';
import PageErrorBoundary from './components/PageErrorBoundary';
import ConsentPage from './pages/ConsentPage';
import SurgicalRecord from './pages/SurgicalRecord';
import * as I from './components/Icons';
import { installGlobalErrorHandlers, initSentry } from './utils/errorLogger';
import { useAuth } from './utils/useAuth';
import { getTodayReport as getLocalTodayReport } from './utils/storage';
import { startReminderScheduler, stopReminderScheduler } from './utils/notifications';
import { signOut } from './utils/supabaseService';
import * as sb from './utils/supabaseService';
import { flushQueue } from './utils/offlineQueue';

initSentry();
installGlobalErrorHandlers();

const patientTabs = [
  { path: '/', label: '首頁', Icon: I.Home },
  { path: '/report', label: '回報', Icon: I.Clipboard },
  { path: '/history', label: '紀錄', Icon: I.Chart },
  { path: '/chat', label: 'AI 衛教', Icon: I.Message },
];

const researcherTabs = [
  { path: '/researcher', label: '概覽', Icon: I.Chart },
  { path: '/lookup', label: '查詢', Icon: I.Search },
  { path: '/review', label: '審核', Icon: I.Message },
];

export default function App() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    authState, isDemo, userInfo, loadingTooLong,
    handleLogin, handleLogout, syncSurgeryDate,
    setAuthState, setUserInfo,
  } = useAuth();

  const [refreshKey, setRefreshKey] = useState(0);
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  const [theme, setTheme] = useState(() => {
    // One-time migration for clinical redesign: reset preference to light
    const UI_VERSION = 'clinical-v1';
    if (localStorage.getItem('ui-version') !== UI_VERSION) {
      localStorage.setItem('ui-version', UI_VERSION);
      localStorage.setItem('theme', 'light');
      return 'light';
    }
    return localStorage.getItem('theme') || 'light';
  });
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentSigned, setConsentSigned] = useState(true); // default true to avoid flash

  // Check consent status for patients
  useEffect(() => {
    if (authState !== 'loggedIn' || isDemo || !userInfo?.studyId) {
      // Non-patient or non-auth — bypass consent gate without async
      queueMicrotask(() => setConsentChecked(true));
      return;
    }
    const isPatient = userInfo?.role === 'patient';
    if (!isPatient) {
      queueMicrotask(() => setConsentChecked(true));
      return;
    }
    let cancelled = false;
    sb.getPatient(userInfo.studyId).then(patient => {
      if (cancelled) return;
      setConsentSigned(patient?.consent_signed ?? false);
      setConsentChecked(true);
    }).catch(() => {
      if (!cancelled) setConsentChecked(true);
    });
    return () => { cancelled = true; };
  }, [authState, isDemo, userInfo]);

  // Theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Notification scheduler + SW message handler
  useEffect(() => {
    if (authState !== 'loggedIn') return;

    const checkReported = async () => {
      if (isDemo) return getLocalTodayReport() !== null;
      if (userInfo?.studyId) {
        const report = await sb.getTodayReport(userInfo.studyId);
        return report !== null;
      }
      return true;
    };

    startReminderScheduler(checkReported);

    const handleSWMessage = (event) => {
      if (event.data?.type === 'NAVIGATE' && event.data?.url) navigate(event.data.url);
      if (event.data?.type === 'SW_UPDATED') setShowUpdateBanner(true);
    };
    navigator.serviceWorker?.addEventListener('message', handleSWMessage);

    return () => {
      stopReminderScheduler();
      navigator.serviceWorker?.removeEventListener('message', handleSWMessage);
    };
  }, [authState, isDemo, userInfo, navigate]);

  // Flush offline queue when coming back online
  useEffect(() => {
    if (authState !== 'loggedIn' || isDemo) return;
    const handleOnline = async () => {
      const { flushed } = await flushQueue(sb.saveReport);
      if (flushed > 0) {
        console.info(`[OfflineQueue] Flushed ${flushed} queued reports`);
        setRefreshKey(k => k + 1); // refresh dashboard
      }
    };
    window.addEventListener('online', handleOnline);
    handleOnline(); // also flush on mount
    return () => window.removeEventListener('online', handleOnline);
  }, [authState, isDemo]);

  const isResearcherRole = userInfo?.role === 'researcher' || userInfo?.role === 'pi';
  const tabs = isResearcherRole ? researcherTabs : patientTabs;

  const commonProps = {
    isDemo,
    userInfo,
    onLogout: () => handleLogout(navigate),
    onSyncSurgeryDate: syncSurgeryDate,
  };

  // Dev-only visual preview for Consent page (no real save, no auth required)
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('previewConsent') === '1') {
    return (
      <ConsentPage
        userInfo={{ studyId: 'HSF-003' }}
        onConsent={() => {
          alert('[Preview] 簽名已擷取，未寫入 Supabase。移除 URL 的 ?previewConsent=1 回到正常流程。');
        }}
        onDecline={() => { window.location.href = window.location.pathname; }}
      />
    );
  }

  // Onboarding state — ensurePatient + session refresh in progress
  if (authState === 'onboarding') {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh' }}>
        <div style={{ textAlign: 'center', maxWidth: 320, padding: 'var(--space-md)' }}>
          <img
            src="/KSVGH.png"
            alt=""
            style={{
              width: '60px', height: '60px', objectFit: 'contain',
              marginBottom: 'var(--space-md)', animation: 'pulse 1s infinite',
              borderRadius: '50%',
            }}
          />
          <h2 style={{ fontSize: 'var(--font-md)', marginBottom: 'var(--space-sm)', fontWeight: 600 }}>
            設定帳號中…
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-xs)', lineHeight: 1.6 }}>
            正在完成病人資料同步與權限設定，<br />請稍候（通常不到 5 秒）。
          </p>
        </div>
      </div>
    );
  }

  // Loading state
  if (authState === 'loading') {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh' }}>
        <div style={{ textAlign: 'center' }}>
          <img src="/KSVGH.png" alt="" style={{ width: '60px', height: '60px', objectFit: 'contain', marginBottom: 'var(--space-md)', animation: 'pulse 1s infinite', borderRadius: '50%' }} />
          <p style={{ color: 'var(--text-secondary)' }}>載入中...</p>
          {loadingTooLong && (
            <div style={{ marginTop: 'var(--space-lg)' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-xs)', marginBottom: 'var(--space-sm)' }}>
                載入時間過長，可能是網路問題。
              </p>
              <button className="btn btn-secondary" style={{ marginBottom: 'var(--space-sm)' }}
                onClick={() => window.location.reload()}>重新整理</button>
              <br />
              <button className="btn btn-secondary" style={{ fontSize: 'var(--font-xs)', opacity: 0.7 }}
                onClick={async () => {
                  try { await signOut(); } catch { /* signOut best-effort */ }
                  setUserInfo(null);
                  setAuthState('loggedOut');
                }}>回到登入頁</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (authState === 'loggedOut') {
    return (
      <Login
        onLogin={(info) => handleLogin(info, navigate)}
        theme={theme}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
      />
    );
  }

  // Consent gate — patients must sign before using the app
  if (consentChecked && !consentSigned && !isDemo && userInfo?.role === 'patient') {
    return (
      <ConsentPage
        userInfo={userInfo}
        onConsent={async (signatureDataUrl) => {
          await sb.recordConsent(userInfo.studyId, signatureDataUrl);
          setConsentSigned(true);
        }}
        onDecline={() => handleLogout(navigate)}
      />
    );
  }

  return (
    <>
      <OfflineBanner />
      <IOSInstallPrompt />
      <UpdateBanner show={showUpdateBanner} />
      <PageErrorBoundary>
        <Routes>
        {/* Patient routes */}
        <Route path="/" element={
          isResearcherRole
            ? <Navigate to="/researcher" replace />
            : <Dashboard key={refreshKey} onNavigate={(tab) => {
                const pathMap = { report: '/report', history: '/history', chat: '/chat', survey: '/survey' };
                navigate(pathMap[tab] || '/');
              }} {...commonProps} />
        } />
        <Route path="/report" element={<SymptomReport onComplete={async () => { await queryClient.invalidateQueries({ queryKey: ['dashboard'] }); await queryClient.invalidateQueries({ queryKey: ['history'] }); setRefreshKey(k => k + 1); navigate('/'); }} {...commonProps} />} />
        <Route path="/history" element={<History key={refreshKey} {...commonProps} />} />
        <Route path="/chat" element={<AIChat {...commonProps} />} />
        <Route path="/survey" element={<UsabilitySurvey onComplete={async () => { await queryClient.invalidateQueries({ queryKey: ['dashboard'] }); await queryClient.invalidateQueries({ queryKey: ['history'] }); setRefreshKey(k => k + 1); navigate('/'); }} {...commonProps} />} />

        {/* Researcher routes */}
        <Route path="/researcher" element={
          <ResearcherDashboard key={refreshKey} onNavigate={(tab) => {
            navigate({ chatReview: '/review', lookup: '/lookup' }[tab] || '/researcher');
          }} {...commonProps} />
        } />
        <Route path="/lookup" element={<ResearcherPatientLookup onNavigate={(tab) => {
          navigate(tab === 'researcherDashboard' ? '/researcher' : '/lookup');
        }} {...commonProps} />} />
        <Route path="/review" element={<ChatReview onNavigate={(tab) => {
          navigate(tab === 'researcherDashboard' ? '/researcher' : '/review');
        }} {...commonProps} />} />
        <Route path="/surgical-record/:studyId" element={<SurgicalRecord {...commonProps} />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </PageErrorBoundary>

      <nav className="bottom-nav">
        {tabs.map(tab => (
          <NavLink key={tab.path} to={tab.path}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            end={tab.path === '/' || tab.path === '/researcher'}>
            <tab.Icon />
            <span>{tab.label}</span>
          </NavLink>
        ))}
        <button className="nav-item" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
          aria-label="切換主題">
          {theme === 'dark' ? <I.Sun /> : <I.Moon />}
          <span>{theme === 'dark' ? '淺色' : '深色'}</span>
        </button>
      </nav>
    </>
  );
}
