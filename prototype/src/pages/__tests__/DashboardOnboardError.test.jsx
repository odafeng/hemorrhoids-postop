// When patient-onboard fails, the patient is holding a JWT with no
// app_metadata claims, so every RLS-backed read denies. The Dashboard's error
// state is the only place that can tell them WHY and offer a retry — the
// generic "請重新登入" is a dead end, because re-login re-runs the same failing
// onboard.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TestQueryWrapper } from '../../test-utils';

const mocks = vi.hoisted(() => ({ useDashboardData: vi.fn() }));

vi.mock('../../utils/hooks', () => ({ useDashboardData: mocks.useDashboardData }));
vi.mock('../../utils/supabaseService', () => ({ markNotificationRead: vi.fn() }));
vi.mock('../../components/NotificationSetup', () => ({ default: () => null }));
vi.mock('../../components/DebugPanel', () => ({ default: () => null }));

const { default: Dashboard } = await import('../Dashboard');

const userInfo = { studyId: 'HSF-001', role: 'patient', surgeryDate: '2026-07-10', pod: 3 };

function renderDashboard(props = {}) {
  return render(
    <TestQueryWrapper>
      <Dashboard onNavigate={vi.fn()} isDemo={false} userInfo={userInfo} onLogout={vi.fn()} {...props} />
    </TestQueryWrapper>,
  );
}

describe('Dashboard — onboarding failure state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useDashboardData.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('MISSING_PATIENT: No patient record found for study_id=HSF-001'),
      refetch: vi.fn(),
      isFetching: false,
    });
  });

  it('shows the onboarding reason instead of the generic advice', () => {
    renderDashboard({ onboardError: '研究編號 HSF-001 已被其他帳號使用，請聯絡研究團隊確認編號。' });

    expect(screen.getByText(/已被其他帳號使用/)).toBeInTheDocument();
    expect(screen.queryByText('請重新登入或聯絡研究團隊。')).not.toBeInTheDocument();
  });

  it('offers a retry so a transient onboard failure is self-recoverable', () => {
    renderDashboard({ onboardError: '帳號設定失敗：伺服器回應異常 (HTTP 200)，請確認網路連線後重試。' });

    expect(screen.getByRole('button', { name: '重試' })).toBeInTheDocument();
  });

  it('falls back to the generic message when there is no onboarding error', () => {
    renderDashboard();

    expect(screen.getByText('請重新登入或聯絡研究團隊。')).toBeInTheDocument();
  });

  it('does not offer a retry for a non-onboarding load failure', () => {
    mocks.useDashboardData.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('network down'),
      refetch: vi.fn(),
      isFetching: false,
    });
    renderDashboard();

    expect(screen.queryByRole('button', { name: '重試' })).not.toBeInTheDocument();
    expect(screen.getByText('network down')).toBeInTheDocument();
  });
});
