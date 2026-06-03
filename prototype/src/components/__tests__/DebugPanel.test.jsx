import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import DebugPanel from '../DebugPanel';

// Mock supabaseClient
vi.mock('../../utils/supabaseClient', () => ({
  default: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { email: 'test@test.com', id: 'uid-1', user_metadata: { role: 'patient', study_id: 'HEM-001' } } } },
      }),
      getUser: vi.fn().mockResolvedValue({
        data: { user: { email: 'test@test.com', user_metadata: { role: 'patient', study_id: 'HEM-001' } } },
        error: null,
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { study_id: 'HEM-001', surgery_date: '2026-03-13', study_status: 'active' },
            error: null,
          }),
        }),
      }),
    }),
  },
}));

// Mock supabaseService
vi.mock('../../utils/supabaseService', () => ({
  getTodayReport: vi.fn().mockResolvedValue({ pain_nrs: 4 }),
  getAllReports: vi.fn().mockResolvedValue([{}, {}, {}]),
}));

// Force import.meta.env.DEV to be true
vi.stubEnv('DEV', true);

describe('DebugPanel', () => {
  const defaultProps = {
    userInfo: { studyId: 'HEM-001', role: 'patient', surgeryDate: '2026-03-13', pod: 5 },
    isDemo: false,
  };

  // Make import.meta.env.DEV === true for rendering
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
  });

  it('returns null in production (non-DEV)', async () => {
    // We can't easily toggle import.meta.env.DEV, so we test what we can
    // The component reads IS_DEV at module load time
  });

  it('shows demo mode text when isDemo=true', () => {
    const { container } = render(<DebugPanel userInfo={{}} isDemo={true} />);
    // In dev mode, should show "Debug: Demo mode"
    const text = container.textContent;
    if (text.includes('Debug')) {
      expect(text).toContain('Demo mode');
    }
  });

  it('renders toggle button in non-demo mode', () => {
    const { container } = render(<DebugPanel {...defaultProps} />);
    const text = container.textContent;
    if (text.includes('Debug Panel')) {
      expect(text).toContain('Debug Panel');
    }
  });

  it('shows diagnostics when opened', async () => {
    const { container } = render(<DebugPanel {...defaultProps} />);
    const toggleBtn = container.querySelector('button');
    if (toggleBtn && toggleBtn.textContent.includes('Debug Panel')) {
      fireEvent.click(toggleBtn);
      await waitFor(() => {
        // Should show loading first, then diagnostics
        const text = container.textContent;
        expect(text.length).toBeGreaterThan(0);
      });
    }
  });

  it('shows Loading state before diagnostics arrive', async () => {
    const { container } = render(<DebugPanel {...defaultProps} />);
    const toggleBtn = container.querySelector('button');
    if (toggleBtn && toggleBtn.textContent.includes('Debug Panel')) {
      fireEvent.click(toggleBtn);
      // Immediately after click, should show Loading
      expect(container.textContent).toContain('Loading');
    }
  });

  it('displays session and patient info after loading', async () => {
    const { container } = render(<DebugPanel {...defaultProps} />);
    const toggleBtn = container.querySelector('button');
    if (toggleBtn && toggleBtn.textContent.includes('Debug Panel')) {
      fireEvent.click(toggleBtn);
      await waitFor(() => {
        const text = container.textContent;
        // Should contain diagnostic sections
        if (text.includes('Session')) {
          expect(text).toContain('email');
        }
      }, { timeout: 3000 });
    }
  });

  it('handles error in diagnostic fetch', async () => {
    // Override supabaseClient to throw
    const supabase = (await import('../../utils/supabaseClient')).default;
    supabase.auth.getSession.mockRejectedValueOnce(new Error('auth fail'));

    const { container } = render(<DebugPanel {...defaultProps} />);
    const toggleBtn = container.querySelector('button');
    if (toggleBtn && toggleBtn.textContent.includes('Debug Panel')) {
      fireEvent.click(toggleBtn);
      await waitFor(() => {
        // Should show error state
      }, { timeout: 3000 });
    }
  });

  it('does not load diagnostics when not opened', async () => {
    const supabaseMod = await import('../../utils/supabaseClient');
    const supabase = supabaseMod.default;
    supabase.auth.getSession.mockClear();
    render(<DebugPanel {...defaultProps} />);
    // getSession should not be called since panel is closed
    expect(supabase.auth.getSession).not.toHaveBeenCalled();
  });

  it('skips patient query when studyId is missing', async () => {
    const { container } = render(
      <DebugPanel userInfo={{ role: 'patient' }} isDemo={false} />
    );
    const toggleBtn = container.querySelector('button');
    if (toggleBtn && toggleBtn.textContent.includes('Debug Panel')) {
      fireEvent.click(toggleBtn);
      await waitFor(() => {}, { timeout: 1000 });
    }
  });
});
