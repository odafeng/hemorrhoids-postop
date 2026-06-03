// Auth hook — encapsulates all auth state, session check, login/logout
import { useState, useEffect } from 'react';
import { onAuthStateChange, getSession, ensurePatient, getPODFromDate, signOut } from './supabaseService';
import supabase from './supabaseClient';
import { seedDemoData } from './storage';

export function useAuth() {
  const [authState, setAuthState] = useState('loading'); // 'loading' | 'onboarding' | 'loggedIn' | 'loggedOut'
  const [isDemo, setIsDemo] = useState(false);
  const [userInfo, setUserInfo] = useState(null);
  const [loadingTooLong, setLoadingTooLong] = useState(false);

  const loadUserInfo = async (session, { attemptedSelfHeal = false } = {}) => {
    const user = session?.user;
    const id = user?.id || null;
    const email = user?.email || null;
    // SECURITY: read authorisation claims (role / study_id / surgeon_id)
    // from app_metadata only — user_metadata is user-writable and forgeable.
    // surgery_date is display-only and can come from user_metadata safely.
    const appMeta = user?.app_metadata || {};
    const userMeta = user?.user_metadata || {};
    const appStudyId = appMeta.study_id;
    const userStudyId = userMeta.study_id;
    const studyId = appStudyId || userStudyId;
    // Only trust app_metadata for the role claim; never fall back to
    // user_metadata.role which a user can set to 'pi'/'researcher' themselves.
    const role = appMeta.role || 'patient';
    const surgeonId = appMeta.surgeon_id || null;
    const surgeryDate = userMeta.surgery_date || null;
    // Staff accounts (researcher/pi) may not have a study_id — allow them
    // through so the router can direct them to the researcher dashboard.
    const isStaff = role === 'researcher' || role === 'pi';
    const inviteToken = typeof window !== 'undefined'
      ? sessionStorage.getItem('invite_token')
      : null;

    // Self-heal / onboarding path — fires when a patient lands here with
    //  (a) an invite_token pending (classic first-signup flow), OR
    //  (b) user_metadata.study_id present but app_metadata.study_id missing.
    // Both cases mean the JWT we're holding will fail every RLS check bound
    // to get_user_study_id() (patients, reports, chat, etc.), so the dashboard
    // would render MISSING_PATIENT until the user manually logs out and back in.
    //
    // Fix: show a dedicated "onboarding" state, call ensurePatient (which
    // creates the patients row and promotes app_metadata via the patient-onboard
    // Edge Function), then refresh the session so the new JWT picks up the
    // promoted claims. Recurse once with attemptedSelfHeal=true to avoid loops.
    const needsOnboarding = !attemptedSelfHeal
      && role === 'patient'
      && !!userStudyId
      && (!appStudyId || !!inviteToken);

    if (needsOnboarding) {
      console.info('[loadUserInfo] onboarding/self-heal', {
        hasInvite: !!inviteToken,
        appMetaDrift: !appStudyId,
      });
      setAuthState('onboarding');
      try {
        if (inviteToken) sessionStorage.removeItem('invite_token');
        await ensurePatient(userStudyId, inviteToken);
        const { data: { session: fresh }, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) throw refreshError;
        if (fresh) {
          // Re-run with fresh session (which should now carry promoted
          // app_metadata.study_id). attemptedSelfHeal flag prevents recursion.
          return loadUserInfo(fresh, { attemptedSelfHeal: true });
        }
      } catch (err) {
        console.error('[loadUserInfo] self-heal failed, falling through:', err);
        // Fall through to normal setUserInfo below — dashboard will show
        // MISSING_PATIENT and the user can fall back to manual logout+login.
      }
    }

    console.info('[loadUserInfo]', { id, studyId, role, surgeryDate, surgeonId });

    if (studyId || isStaff) {
      setUserInfo({
        id,
        email,
        studyId: studyId || null,
        role,
        surgeryDate,
        surgeonId,
        pod: surgeryDate ? getPODFromDate(surgeryDate) : 0,
      });
    }
  };

  // Check auth on mount
  useEffect(() => {
    const loadingTimer = setTimeout(() => setLoadingTooLong(true), 8000);

    const checkAuth = async () => {
      try {
        const session = await getSession();
        if (!session) {
          setAuthState('loggedOut');
          return;
        }

        await loadUserInfo(session);
        setAuthState('loggedIn');

        // Background server-verify
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const cachedStudyId = session.user?.user_metadata?.study_id;
            const freshStudyId = user.user_metadata?.study_id;
            if (freshStudyId && freshStudyId !== cachedStudyId) {
              console.warn('[checkAuth] Metadata drift detected, refreshing');
              const freshSession = { ...session, user: { ...session.user, user_metadata: user.user_metadata } };
              await loadUserInfo(freshSession, { attemptedSelfHeal: true });
            }
          }
        } catch (e) {
          console.warn('[checkAuth] Background verify failed (non-fatal):', e.message);
        }
      } catch (e) {
        console.error('[checkAuth] Fatal error:', e);
        setAuthState('loggedOut');
      } finally {
        clearTimeout(loadingTimer);
      }
    };
    checkAuth();

    const { data: { subscription } } = onAuthStateChange(async (_event, session) => {
      if (session) {
        await loadUserInfo(session);
        setAuthState('loggedIn');
      } else {
        setAuthState('loggedOut');
        setUserInfo(null);
        setIsDemo(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogin = (info, navigate) => {
    if (info?.demo) {
      setIsDemo(true);
      const role = info.role || 'patient';
      const isResearcherLogin = role === 'researcher' || role === 'pi';
      if (!isResearcherLogin) seedDemoData();
      setUserInfo({
        studyId: info.studyId || 'DEMO-001',
        role,
        surgeryDate: null,
        surgeonId: info.surgeonId || null,
        pod: 0,
      });
      setAuthState('loggedIn');
      navigate(isResearcherLogin ? '/researcher' : '/');
    }
  };

  const handleLogout = async (navigate) => {
    if (isDemo) {
      setIsDemo(false);
      setUserInfo(null);
      setAuthState('loggedOut');
    } else {
      try {
        await signOut();
      } catch (e) {
        console.error('[handleLogout] signOut failed:', e);
      }
      setUserInfo(null);
      setAuthState('loggedOut');
    }
    navigate('/');
  };

  const syncSurgeryDate = (dbSurgeryDate) => {
    if (dbSurgeryDate && dbSurgeryDate !== userInfo?.surgeryDate) {
      setUserInfo(prev => prev ? {
        ...prev,
        surgeryDate: dbSurgeryDate,
        pod: getPODFromDate(dbSurgeryDate),
      } : prev);
    }
  };

  return {
    authState, isDemo, userInfo, loadingTooLong,
    handleLogin, handleLogout, syncSurgeryDate,
    setAuthState, setUserInfo,
  };
}
