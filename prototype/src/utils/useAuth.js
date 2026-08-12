// Auth hook — encapsulates all auth state, session check, login/logout
import { useState, useEffect } from 'react';
import { onAuthStateChange, getSession, ensurePatient, getPODFromDate, signOut } from './supabaseService';
import supabase from './supabaseClient';
import { seedDemoData } from './storage';
import { clearQueue, getQueueCount } from './offlineQueue';

export function useAuth() {
  const [authState, setAuthState] = useState('loading'); // 'loading' | 'onboarding' | 'loggedIn' | 'loggedOut'
  const [isDemo, setIsDemo] = useState(false);
  const [userInfo, setUserInfo] = useState(null);
  const [loadingTooLong, setLoadingTooLong] = useState(false);
  const [onboardError, setOnboardError] = useState(null);
  // Set when the session came from a password-recovery link. Supabase signs the
  // user in but does NOT change the password, so the app must ask for a new one
  // — otherwise "忘記密碼" silently does nothing but log you in.
  // Seeded from the flag index.html captures before any module runs, because
  // supabase-js may consume the URL hash before our listener is attached.
  const [passwordRecovery, setPasswordRecovery] = useState(
    () => typeof window !== 'undefined' && window.__PASSWORD_RECOVERY__ === true,
  );
  // Same problem, worse consequence: an invite link signs the researcher in
  // against an account GoTrue stamped with a RANDOM password. Land them on the
  // dashboard and they can never sign in again — the password they'd need does
  // not exist anywhere.
  //
  // Detected from the account (user_metadata.invited_at, written by
  // researcher-invite and answered by password_set_at) rather than from the URL,
  // because supabase-js clears the hash on the first load. Reading the URL would
  // mean a researcher who reloads before choosing a password is locked out for
  // good, which is the failure this whole path exists to prevent.
  const [inviteNeedsPassword, setInviteNeedsPassword] = useState(false);
  const passwordSetup = passwordRecovery ? 'recovery' : inviteNeedsPassword ? 'invite' : null;

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
    setInviteNeedsPassword(!!userMeta.invited_at && !userMeta.password_set_at);
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
      setOnboardError(null);
      try {
        await ensurePatient(userStudyId, inviteToken);
        // Only burn the one-shot invite token once the server has actually
        // accepted it. Dropping it before the call stranded the patient on
        // any transient failure: no patients row, no app_metadata claims,
        // and no UI anywhere to re-enter the code.
        if (inviteToken) sessionStorage.removeItem('invite_token');
        const { data: { session: fresh }, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) throw refreshError;
        if (fresh) {
          // Re-run with fresh session (which should now carry promoted
          // app_metadata.study_id). attemptedSelfHeal flag prevents recursion.
          return loadUserInfo(fresh, { attemptedSelfHeal: true });
        }
      } catch (err) {
        console.error('[loadUserInfo] self-heal failed, falling through:', err);
        // Token is deliberately left in sessionStorage so a retry (reload or
        // re-login in the same tab) can still complete the onboarding.
        setOnboardError(err?.message || '帳號設定失敗，請重試或聯絡研究團隊。');
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

    const { data: { subscription } } = onAuthStateChange(async (event, session) => {
      // Fired when the user opens a recovery link. supabase-js consumes the
      // token from the URL hash and establishes a session — the password itself
      // is unchanged until updateUser({password}) is called, so flag it and let
      // App render the set-new-password screen instead of the dashboard.
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      if (session) {
        await loadUserInfo(session);
        setAuthState('loggedIn');
      } else {
        setAuthState('loggedOut');
        setUserInfo(null);
        setIsDemo(false);
        setPasswordRecovery(false);
        setInviteNeedsPassword(false);
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
    // The offline queue is keyed by study_id but flushed with whatever session
    // is active. On a shared clinic device, leaving items behind would send the
    // previous patient's report under the next patient's credentials.
    const stranded = getQueueCount();
    if (stranded > 0) {
      console.warn(`[handleLogout] discarding ${stranded} unsent queued report(s)`);
    }
    clearQueue();
    // A pending invite token is equally account-specific.
    if (typeof window !== 'undefined') sessionStorage.removeItem('invite_token');

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
    setOnboardError(null);
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

  const completePasswordSetup = () => {
    setPasswordRecovery(false);
    setInviteNeedsPassword(false);
    if (typeof window !== 'undefined') window.__PASSWORD_RECOVERY__ = false;
  };

  return {
    authState, isDemo, userInfo, loadingTooLong, onboardError,
    passwordSetup, completePasswordSetup,
    handleLogin, handleLogout, syncSurgeryDate,
    setAuthState, setUserInfo,
  };
}
