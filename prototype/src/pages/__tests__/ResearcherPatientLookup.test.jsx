import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { TestQueryWrapper } from '../../test-utils';
import ResearcherPatientLookup from '../ResearcherPatientLookup';

vi.mock('../../utils/supabaseService', () => ({
  getPatient: vi.fn(),
  getAllReports: vi.fn(),
  getAlerts: vi.fn(),
  getPODFromDate: vi.fn(() => 2),
  getSignedSignatureUrl: vi.fn(),
  adminResetPassword: vi.fn(),
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
});
