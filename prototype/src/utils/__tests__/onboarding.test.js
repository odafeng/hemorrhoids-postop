// Regression tests for the patient onboarding hand-off.
//
// The invite token is one-shot and lives only in sessionStorage: there is no
// UI anywhere that lets a patient re-enter it. If it is dropped while the
// server-side onboard failed, the account is stranded forever (auth user with
// no patients row, no app_metadata claims, every RLS check denied) and only a
// manual DB fix can recover it. These tests pin that hand-off.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  ensurePatient: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  signOut: vi.fn(),
  getPODFromDate: vi.fn(() => 3),
  refreshSession: vi.fn(),
  getUser: vi.fn(async () => ({ data: { user: null } })),
}));

vi.mock('../supabaseService', () => ({
  ensurePatient: mocks.ensurePatient,
  getSession: mocks.getSession,
  onAuthStateChange: mocks.onAuthStateChange,
  signOut: mocks.signOut,
  getPODFromDate: mocks.getPODFromDate,
}));

vi.mock('../supabaseClient', () => ({
  default: { auth: { refreshSession: mocks.refreshSession, getUser: mocks.getUser } },
  supabase: { auth: { refreshSession: mocks.refreshSession, getUser: mocks.getUser } },
}));

vi.mock('../storage', () => ({ seedDemoData: vi.fn() }));

// A freshly-signed-up patient: study_id lives in user_metadata, app_metadata is
// still empty because only patient-onboard can promote the trusted claims.
const pendingSession = {
  user: {
    id: 'user-1',
    email: 'p@example.com',
    app_metadata: {},
    user_metadata: { study_id: 'HSF-001', surgery_date: '2026-07-10' },
  },
};

const onboardedSession = {
  user: {
    id: 'user-1',
    email: 'p@example.com',
    app_metadata: { role: 'patient', study_id: 'HSF-001', surgeon_id: 'HSF' },
    user_metadata: { study_id: 'HSF-001', surgery_date: '2026-07-10' },
  },
};

// researcher-invite stamps user_metadata.invited_at when it calls
// inviteUserByEmail. GoTrue gives that account a RANDOM password nobody knows,
// so until the researcher picks one they cannot log in again.
const invitedResearcherSession = {
  user: {
    id: 'user-2',
    email: 'r@example.com',
    app_metadata: { role: 'researcher', surgeon_id: 'HSF' },
    user_metadata: { display_name: '王研究', invited_at: '2026-08-12T04:32:23.914Z' },
  },
};

const settledResearcherSession = {
  user: {
    ...invitedResearcherSession.user,
    user_metadata: {
      ...invitedResearcherSession.user.user_metadata,
      password_set_at: '2026-08-12T04:40:00.000Z',
    },
  },
};

describe('useAuth — invite token hand-off', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.getSession.mockResolvedValue(pendingSession);
    mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the invite token when onboarding fails, so a retry can still use it', async () => {
    sessionStorage.setItem('invite_token', 'INVITE-XYZ');
    mocks.ensurePatient.mockRejectedValue(new Error('patient-onboard failed (HTTP 503)'));

    const { useAuth } = await import('../useAuth');
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(mocks.ensurePatient).toHaveBeenCalled());
    await waitFor(() => expect(result.current.onboardError).toBeTruthy());

    expect(mocks.ensurePatient).toHaveBeenCalledWith('HSF-001', 'INVITE-XYZ');
    expect(sessionStorage.getItem('invite_token')).toBe('INVITE-XYZ');
  });

  it('surfaces the server reason so the patient sees something actionable', async () => {
    sessionStorage.setItem('invite_token', 'INVITE-XYZ');
    mocks.ensurePatient.mockRejectedValue(
      new Error('研究編號 HSF-001 已被其他帳號使用，請聯絡研究團隊確認編號。'),
    );

    const { useAuth } = await import('../useAuth');
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.onboardError).toContain('已被其他帳號使用'));
  });

  it('burns the invite token only after the server accepted it', async () => {
    sessionStorage.setItem('invite_token', 'INVITE-XYZ');
    mocks.ensurePatient.mockResolvedValue({ study_id: 'HSF-001', surgery_date: '2026-07-10' });
    mocks.refreshSession.mockResolvedValue({ data: { session: onboardedSession }, error: null });

    const { useAuth } = await import('../useAuth');
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(sessionStorage.getItem('invite_token')).toBeNull());
    await waitFor(() => expect(result.current.userInfo?.studyId).toBe('HSF-001'));
    expect(result.current.onboardError).toBeNull();
  });
});

describe('useAuth — password recovery detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    delete window.__PASSWORD_RECOVERY__;
    mocks.getSession.mockResolvedValue(onboardedSession);
    mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.__PASSWORD_RECOVERY__;
  });

  it('is off for an ordinary login', async () => {
    const { useAuth } = await import('../useAuth');
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.authState).toBe('loggedIn'));
    expect(result.current.passwordSetup).toBeNull();
  });

  // supabase-js consumes the URL hash when the client is constructed — at
  // import time, before this hook can attach a listener — so the
  // PASSWORD_RECOVERY event can be gone before anyone is listening. index.html
  // records the flag first; missing it is what made the reset link look inert.
  it('picks up the flag index.html captured before any module ran', async () => {
    window.__PASSWORD_RECOVERY__ = true;
    const { useAuth } = await import('../useAuth');
    const { result } = renderHook(() => useAuth());
    expect(result.current.passwordSetup).toBe('recovery');
  });

  it('also reacts to a live PASSWORD_RECOVERY event', async () => {
    let emit;
    mocks.onAuthStateChange.mockImplementation((cb) => {
      emit = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    const { useAuth } = await import('../useAuth');
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(emit).toBeTypeOf('function'));
    expect(result.current.passwordSetup).toBeNull();

    await act(async () => { await emit('PASSWORD_RECOVERY', onboardedSession); });
    expect(result.current.passwordSetup).toBe('recovery');
  });

  it('clears the flag once the new password is saved', async () => {
    window.__PASSWORD_RECOVERY__ = true;
    const { useAuth } = await import('../useAuth');
    const { result } = renderHook(() => useAuth());
    expect(result.current.passwordSetup).toBe('recovery');

    act(() => result.current.completePasswordSetup());

    expect(result.current.passwordSetup).toBeNull();
    // Also cleared on window, or a later re-mount would re-open the screen.
    expect(window.__PASSWORD_RECOVERY__).toBe(false);
  });

  it('clears the flag on sign-out so it cannot leak to the next account', async () => {
    window.__PASSWORD_RECOVERY__ = true;
    let emit;
    mocks.onAuthStateChange.mockImplementation((cb) => {
      emit = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    const { useAuth } = await import('../useAuth');
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(emit).toBeTypeOf('function'));

    await act(async () => { await emit('SIGNED_OUT', null); });
    expect(result.current.passwordSetup).toBeNull();
  });
});

// An invited researcher lands on a session GoTrue created with a random
// password. Nothing in the URL survives a reload, so detection has to come from
// the account itself — otherwise closing the tab before choosing a password
// locks them out of an account they can never sign into again.
describe('useAuth — invited researcher must choose a password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    delete window.__PASSWORD_RECOVERY__;
    mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.__PASSWORD_RECOVERY__;
  });

  it('demands a password on the load that follows the invite link', async () => {
    mocks.getSession.mockResolvedValue(invitedResearcherSession);
    const { useAuth } = await import('../useAuth');
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.authState).toBe('loggedIn'));
    expect(result.current.passwordSetup).toBe('invite');
  });

  // The regression that matters: the invite hash is gone on the second load.
  it('still demands one after a reload, with no URL hash left to read', async () => {
    mocks.getSession.mockResolvedValue(invitedResearcherSession);
    const { useAuth } = await import('../useAuth');
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.authState).toBe('loggedIn'));
    // Nothing was ever written to window — detection came from the account.
    expect(window.__PASSWORD_RECOVERY__).toBeUndefined();
    expect(result.current.passwordSetup).toBe('invite');
  });

  it('leaves a researcher who already chose one alone', async () => {
    mocks.getSession.mockResolvedValue(settledResearcherSession);
    const { useAuth } = await import('../useAuth');
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.authState).toBe('loggedIn'));
    expect(result.current.passwordSetup).toBeNull();
  });

  it('never fires for a patient, who picked a password at sign-up', async () => {
    mocks.getSession.mockResolvedValue(onboardedSession);
    const { useAuth } = await import('../useAuth');
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.authState).toBe('loggedIn'));
    expect(result.current.passwordSetup).toBeNull();
  });

  it('stops demanding one once the password is saved', async () => {
    mocks.getSession.mockResolvedValue(invitedResearcherSession);
    const { useAuth } = await import('../useAuth');
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.passwordSetup).toBe('invite'));
    act(() => result.current.completePasswordSetup());
    expect(result.current.passwordSetup).toBeNull();
  });
});

// NOTE: ensurePatient itself is exercised in ensurePatient.test.js — it cannot
// live here because vi.mock('../supabaseService') is hoisted to the top of this
// file and applies to every import within it, mock included.
