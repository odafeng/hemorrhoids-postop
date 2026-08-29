import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { TestQueryWrapper, createTestQueryClient } from '../../test-utils';
import ResearcherPatientLookup from '../ResearcherPatientLookup';

vi.mock('../../utils/supabaseService', () => ({
  getPatient: vi.fn(),
  getAllReports: vi.fn(),
  getAlerts: vi.fn(),
  getPODFromDate: vi.fn(() => 2),
  getSignedSignatureUrl: vi.fn(),
  adminResetPassword: vi.fn(),
  addUtilization: vi.fn(),
}));
import * as sb from '../../utils/supabaseService';

const TWO_REPORTS = [
  { report_date: '2026-07-26', pod: 2, pain_nrs: 3, bleeding: '少量', bowel: '正常', fever: false, wound: '無異常', urinary: '正常', continence: '正常' },
  { report_date: '2026-07-25', pod: 1, pain_nrs: 5, bleeding: '血塊', bowel: '未排', fever: false, wound: '腫脹', urinary: '正常', continence: '正常' },
];

async function lookup(studyId = 'HSF-001') {
  render(<ResearcherPatientLookup onNavigate={() => {}} isDemo={false} />, { wrapper: TestQueryWrapper });
  fireEvent.change(screen.getByPlaceholderText(/搜尋病人編號/), { target: { value: studyId } });
  fireEvent.click(screen.getByRole('button', { name: /查詢/ }));
}

describe('ResearcherPatientLookup — 逐日明細', () => {
  beforeEach(() => {
    sb.getPatient.mockResolvedValue({ study_id: 'HSF-001', study_status: 'active', surgery_date: '2026-07-24' });
    sb.getAlerts.mockResolvedValue([]);
  });

  it('查到病人後，逐日明細列出每天的 POD 與疼痛值', async () => {
    sb.getAllReports.mockResolvedValue(TWO_REPORTS);
    await lookup();
    await waitFor(() => expect(screen.getByText(/POD 2 · 2026-07-26/)).toBeInTheDocument());
    expect(screen.getByText(/POD 1 · 2026-07-25/)).toBeInTheDocument();
    // Scoped to each day row: "Latest NRS" in CASE DETAIL always mirrors the
    // newest report's pain_nrs, so an unscoped getByText('3') is ambiguous.
    const day2 = screen.getByText(/POD 2 · 2026-07-26/).closest('.tl-item');
    const day1 = screen.getByText(/POD 1 · 2026-07-25/).closest('.tl-item');
    expect(within(day2).getByText('3')).toBeInTheDocument();
    expect(within(day1).getByText('5')).toBeInTheDocument();
  });

  it('病人已建檔但 0 筆回報 → 顯示尚無回報紀錄', async () => {
    sb.getAllReports.mockResolvedValue([]);
    await lookup();
    await waitFor(() => expect(screen.getByText('尚無回報紀錄')).toBeInTheDocument());
  });

  it('查到病人後渲染疼痛趨勢圖（SVG）與標題', async () => {
    sb.getAllReports.mockResolvedValue(TWO_REPORTS);
    const { container } = render(<ResearcherPatientLookup onNavigate={() => {}} isDemo={false} />, { wrapper: TestQueryWrapper });
    fireEvent.change(screen.getByPlaceholderText(/搜尋病人編號/), { target: { value: 'HSF-001' } });
    fireEvent.click(screen.getByRole('button', { name: /查詢/ }));
    await waitFor(() => expect(screen.getByText(/疼痛分數趨勢/)).toBeInTheDocument());
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('用 /lookup/:studyId 進入時自動載入該病人', async () => {
    sb.getAllReports.mockResolvedValue(TWO_REPORTS);
    const client = createTestQueryClient();
    render(
      <MemoryRouter initialEntries={['/lookup/HSF-001']}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/lookup/:studyId" element={<ResearcherPatientLookup onNavigate={() => {}} isDemo={false} />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText(/POD 2 · 2026-07-26/)).toBeInTheDocument());
    expect(sb.getPatient).toHaveBeenCalledWith('HSF-001');
  });
});

describe('ResearcherPatientLookup — 登錄就醫事件', () => {
  beforeEach(() => {
    sb.getPatient.mockResolvedValue({ study_id: 'HSF-001', study_status: 'active', surgery_date: '2026-07-24' });
    sb.getAlerts.mockResolvedValue([]);
    sb.getAllReports.mockResolvedValue(TWO_REPORTS);
    sb.addUtilization.mockResolvedValue(undefined);
  });

  it('POD 由就醫日期與手術日期算出，不讓人手填', async () => {
    await lookup();
    await waitFor(() => expect(screen.getByText('登錄就醫事件')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('就醫類型'), { target: { value: '急診' } });
    fireEvent.change(screen.getByPlaceholderText('就醫日期'), { target: { value: '2026-07-30' } });
    fireEvent.change(screen.getByPlaceholderText(/就醫原因/), { target: { value: '術後出血' } });
    fireEvent.click(screen.getByRole('button', { name: '登錄' }));

    await waitFor(() => expect(sb.addUtilization).toHaveBeenCalledWith({
      studyId: 'HSF-001', eventType: '急診', eventDate: '2026-07-30',
      reason: '術後出血', podAtEvent: 6,
    }));
  });

  it('日期或原因沒填時按鈕不可按', async () => {
    await lookup();
    await waitFor(() => expect(screen.getByText('登錄就醫事件')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '登錄' })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('就醫日期'), { target: { value: '2026-07-30' } });
    expect(screen.getByRole('button', { name: '登錄' })).toBeDisabled();
  });

  it('寫入失敗時把錯誤顯示出來，不要無聲', async () => {
    sb.addUtilization.mockRejectedValue(new Error('permission denied'));
    await lookup();
    await waitFor(() => expect(screen.getByText('登錄就醫事件')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('就醫日期'), { target: { value: '2026-07-30' } });
    fireEvent.change(screen.getByPlaceholderText(/就醫原因/), { target: { value: '術後出血' } });
    fireEvent.click(screen.getByRole('button', { name: '登錄' }));

    await waitFor(() => expect(screen.getByText(/permission denied/)).toBeInTheDocument());
  });
});
