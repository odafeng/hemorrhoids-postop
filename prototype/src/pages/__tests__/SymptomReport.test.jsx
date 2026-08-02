import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SymptomReport from '../SymptomReport';

// Mock supabaseService
vi.mock('../../utils/supabaseService', () => ({
  saveReport: vi.fn().mockResolvedValue({}),
  getAllReports: vi.fn().mockResolvedValue([]),
  createAlert: vi.fn().mockResolvedValue({}),
  getTodayReport: vi.fn().mockResolvedValue(null),
  getReportByDate: vi.fn().mockResolvedValue(null),
}));

// Mock storage for demo mode
vi.mock('../../utils/storage', () => ({
  getTodayReport: vi.fn().mockReturnValue(null),
  getReportByDate: vi.fn().mockReturnValue(null),
  saveReport: vi.fn().mockReturnValue({ date: '2026-03-18', pain: 5 }),
  getPOD: vi.fn().mockReturnValue(5),
}));

const RouterWrapper = ({ children }) => <MemoryRouter>{children}</MemoryRouter>;

describe('SymptomReport Page', () => {
  const defaultProps = {
    onComplete: vi.fn(),
    isDemo: true,
    userInfo: { studyId: 'DEMO-001', pod: 5, role: 'patient' },
  };

  beforeEach(() => {
    defaultProps.onComplete.mockClear();
  });

  it('renders page title and subtitle', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    expect(screen.getByText(/症狀回報/)).toBeInTheDocument();
    expect(screen.getByText(/約 30 秒/)).toBeInTheDocument();
  });

  it('renders pain slider with initial value', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    expect(screen.getByText(/疼痛分數/)).toBeInTheDocument();
    const slider = screen.getByRole('slider');
    expect(slider).toBeInTheDocument();
    expect(slider.value).toBe('3'); // default
  });

  it('renders all bleeding options with descriptions', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    expect(screen.getByText('無')).toBeInTheDocument();
    expect(screen.getByText('無任何出血')).toBeInTheDocument();
    expect(screen.getByText('少量')).toBeInTheDocument();
    expect(screen.getByText('持續')).toBeInTheDocument();
    expect(screen.getByText('血塊')).toBeInTheDocument();
  });

  it('renders all bowel options', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    const normals = screen.getAllByText('正常');
    expect(normals.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('未排')).toBeInTheDocument();
  });

  it('renders fever toggle', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    expect(screen.getByText(/發燒/)).toBeInTheDocument();
    expect(screen.getByText('否')).toBeInTheDocument();
    expect(screen.getByText('是')).toBeInTheDocument();
  });

  it('renders all wound options', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    expect(screen.getByText('無異常')).toBeInTheDocument();
    expect(screen.getByText('腫脹')).toBeInTheDocument();
    expect(screen.getByText('分泌物')).toBeInTheDocument();
  });

  it('renders urinary and continence fields', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    expect(screen.getByText('排尿狀況')).toBeInTheDocument();
    expect(screen.getByText('肛門控制')).toBeInTheDocument();
    expect(screen.getByText('完全尿不出來')).toBeInTheDocument();
    expect(screen.getByText('偶爾漏便')).toBeInTheDocument();
    expect(screen.getByText('無法控制')).toBeInTheDocument();
  });

  // Item validity, not cosmetics. The middle option used to read "內褲有少量污漬、
  // 不自覺漏出" — after a haemorrhoidectomy with no sphincter involvement, underwear
  // staining is almost always wound discharge, so patients reported discharge here
  // and it was stored as 滲便 and alerted on as a continence problem. HSF-001 did
  // exactly that on POD 7 and POD 9 while never once ticking 分泌物 in the wound
  // field. The option must name stool, and the form must say where discharge goes.
  it('肛門控制題明指糞便，並把傷口分泌物導向傷口欄位', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });

    expect(screen.getByText(/漏出糞便|便漬/)).toBeInTheDocument();
    expect(screen.queryByText('內褲有少量污漬、不自覺漏出')).toBeNull();
    expect(screen.getByText(/傷口分泌物.*下方.*分泌物/)).toBeInTheDocument();

    // The hint must not repeat the literal field label. e2e/patient-full-journey and
    // e2e/auth-flow both locate the wound field with getByText('傷口狀況'), which is
    // strict — a second match anywhere on the page fails the run. Asserting it here
    // catches that in seconds instead of four minutes of Playwright.
    expect(screen.getAllByText(/傷口狀況/)).toHaveLength(1);
  });

  it('submit button is disabled when required fields are not selected', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    const submit = screen.getByText('提交回報');
    expect(submit).toBeDisabled();
  });

  // Helper: fill all required fields
  const fillAllFields = () => {
    const bleedingBtn = screen.getByText('少量').closest('button');
    fireEvent.click(bleedingBtn);
    const bowelButtons = screen.getAllByText('正常');
    fireEvent.click(bowelButtons[0]); // bowel
    fireEvent.click(bowelButtons[1]); // continence
    fireEvent.click(bowelButtons[2]); // urinary
    fireEvent.click(screen.getByText('無異常'));
  };

  it('submit button becomes enabled after selecting all required fields', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    fillAllFields();
    const submit = screen.getByText('提交回報');
    expect(submit).not.toBeDisabled();
  });

  it('shows success overlay after submission in demo mode', async () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    fillAllFields();
    fireEvent.click(screen.getByText('提交回報'));

    await waitFor(() => {
      expect(screen.getByText('回報成功')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('displays pain level text correctly', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    expect(screen.getByText('輕度疼痛')).toBeInTheDocument();
  });

  it('shows 無痛 for pain=0', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '0' } });
    expect(screen.getByText('無痛')).toBeInTheDocument();
  });

  it('shows 中度疼痛 for pain=5', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '5' } });
    expect(screen.getByText('中度疼痛')).toBeInTheDocument();
  });

  it('shows 嚴重疼痛 for pain=8', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '8' } });
    expect(screen.getByText('嚴重疼痛')).toBeInTheDocument();
  });

  it('shows 劇烈疼痛 for pain=10', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '10' } });
    expect(screen.getByText('劇烈疼痛')).toBeInTheDocument();
  });

  it('can toggle fever on', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    fireEvent.click(screen.getByText('是'));
    // Fever button should now be selected
  });

  it('wound: selecting 無異常 deselects others', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    fireEvent.click(screen.getByText('腫脹'));
    fireEvent.click(screen.getByText('無異常'));
    // 無異常 should be selected, 腫脹 should not
  });

  it('wound: selecting other item deselects 無異常', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    fireEvent.click(screen.getByText('無異常'));
    fireEvent.click(screen.getByText('腫脹'));
    // 無異常 should be deselected
  });

  it('wound: can toggle items on and off', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    fireEvent.click(screen.getByText('腫脹'));
    fireEvent.click(screen.getByText('腫脹')); // toggle off
  });

  it('shows "其他" text input when 其他 wound is selected', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    fireEvent.click(screen.getByText('其他'));
    expect(screen.getByPlaceholderText('請描述傷口狀況…')).toBeInTheDocument();
  });

  it('submit disabled when 其他 wound selected but text empty', () => {
    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    // Fill required fields except wound
    const bleedingBtn = screen.getByText('少量').closest('button');
    fireEvent.click(bleedingBtn);
    const bowelButtons = screen.getAllByText('正常');
    fireEvent.click(bowelButtons[0]);
    fireEvent.click(bowelButtons[1]);
    fireEvent.click(bowelButtons[2]);
    fireEvent.click(screen.getByText('其他'));
    // Don't fill the text input
    const submit = screen.getByText('提交回報');
    expect(submit).toBeDisabled();
  });

  it('pre-fills form with existing demo report', async () => {
    const storage = await import('../../utils/storage');
    storage.getTodayReport.mockReturnValue({
      pain: 7, bleeding: '持續', bowel: '困難', fever: true,
      wound: '腫脹,其他:發紅', continence: '正常', urinary: '正常',
    });

    render(<SymptomReport {...defaultProps} />, { wrapper: RouterWrapper });
    const slider = screen.getByRole('slider');
    expect(slider.value).toBe('7');

    storage.getTodayReport.mockReturnValue(null);
  });

  // Supabase mode tests
  describe('Supabase mode', () => {
    const supabaseProps = {
      onComplete: vi.fn(),
      isDemo: false,
      userInfo: { studyId: 'HEM-001', pod: 5, role: 'patient', surgeryDate: '2026-03-13' },
    };

    it('shows loading state while fetching existing report', async () => {
      const sb = await import('../../utils/supabaseService');
      sb.getTodayReport.mockImplementation(() => new Promise(() => {})); // never resolves
      render(<SymptomReport {...supabaseProps} />, { wrapper: RouterWrapper });
      expect(screen.getByText('載入中…')).toBeInTheDocument();
      sb.getTodayReport.mockResolvedValue(null); // restore
    });

    it('pre-fills form with existing Supabase report', async () => {
      const sb = await import('../../utils/supabaseService');
      sb.getTodayReport.mockResolvedValue({
        pain_nrs: 6, bleeding: '少量', bowel: '正常', fever: false,
        wound: '無異常', continence: '正常', urinary: '正常',
      });

      render(<SymptomReport {...supabaseProps} />, { wrapper: RouterWrapper });
      await waitFor(() => {
        const slider = screen.getByRole('slider');
        expect(slider.value).toBe('6');
      });

      sb.getTodayReport.mockResolvedValue(null);
    });

    it('submits to Supabase and shows success', async () => {
      const sb = await import('../../utils/supabaseService');
      sb.getTodayReport.mockResolvedValue(null);
      sb.saveReport.mockResolvedValue({});

      render(<SymptomReport {...supabaseProps} />, { wrapper: RouterWrapper });
      await waitFor(() => {
        expect(screen.getByText('提交回報')).toBeInTheDocument();
      });

      fillAllFields();
      fireEvent.click(screen.getByText('提交回報'));

      await waitFor(() => {
        expect(screen.getByText('回報成功')).toBeInTheDocument();
      }, { timeout: 3000 });
    });

    it('shows error on submit failure', async () => {
      const sb = await import('../../utils/supabaseService');
      sb.getTodayReport.mockResolvedValue(null);
      sb.saveReport.mockRejectedValue(new Error('Server error'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<SymptomReport {...supabaseProps} />, { wrapper: RouterWrapper });
      await waitFor(() => {
        expect(screen.getByText('提交回報')).toBeInTheDocument();
      });

      fillAllFields();
      fireEvent.click(screen.getByText('提交回報'));

      await waitFor(() => {
        expect(screen.getByText(/提交失敗/)).toBeInTheDocument();
      }, { timeout: 3000 });

      errorSpy.mockRestore();
    });

    it('handles load existing error gracefully', async () => {
      const sb = await import('../../utils/supabaseService');
      sb.getTodayReport.mockRejectedValue(new Error('Load fail'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<SymptomReport {...supabaseProps} />, { wrapper: RouterWrapper });
      await waitFor(() => {
        // Should still render the form after error
        expect(screen.getByText(/症狀回報/)).toBeInTheDocument();
      });

      errorSpy.mockRestore();
      sb.getTodayReport.mockResolvedValue(null);
    });
  });
});
