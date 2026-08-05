import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../../test-utils';
import ResearcherDashboard from '../ResearcherDashboard';

vi.mock('../../utils/supabaseService', () => ({
  getAllPatients: vi.fn(),
  getAdherenceSummary: vi.fn(),
  getAllAlertsForResearcher: vi.fn(),
  getUnreviewedChats: vi.fn(),
  getAllReportsForResearcher: vi.fn(),
  listStudyInvites: vi.fn(),
  listResearchers: vi.fn(),
  resendResearcherActivation: vi.fn(),
}));
import * as sb from '../../utils/supabaseService';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}

describe('ResearcherDashboard — cohort row navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sb.getAllPatients.mockResolvedValue([
      { study_id: 'HSF-001', surgeon_id: 'HSF', study_status: 'active', surgery_date: '2026-07-24' },
    ]);
    sb.getAdherenceSummary.mockResolvedValue([]);
    sb.getAllAlertsForResearcher.mockResolvedValue([]);
    sb.getUnreviewedChats.mockResolvedValue([]);
    sb.getAllReportsForResearcher.mockResolvedValue([]);
    sb.listStudyInvites.mockResolvedValue([]);
    sb.listResearchers.mockResolvedValue([]);
    sb.resendResearcherActivation.mockResolvedValue({ success: true });
  });

  it('點 cohort 列導覽到該病人詳情', async () => {
    const client = createTestQueryClient();
    render(
      <MemoryRouter initialEntries={['/researcher']}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/researcher" element={<ResearcherDashboard onNavigate={() => {}} isDemo={false} userInfo={{ role: 'pi' }} onLogout={() => {}} />} />
            <Route path="/lookup/:studyId" element={<LocationProbe />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    );
    const idCell = await screen.findByText('HSF-001');
    fireEvent.click(idCell.closest('.cohort-row'));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/lookup/HSF-001'));
  });

  it('點列內的撰寫手術紀錄按鈕只導覽到手術紀錄，不觸發列導覽', async () => {
    const client = createTestQueryClient();
    render(
      <MemoryRouter initialEntries={['/researcher']}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/researcher" element={<ResearcherDashboard onNavigate={() => {}} isDemo={false} userInfo={{ role: 'pi' }} onLogout={() => {}} />} />
            <Route path="/lookup/:studyId" element={<LocationProbe />} />
            <Route path="/surgical-record/:studyId" element={<LocationProbe />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    );
    const recordBtn = await screen.findByRole('button', { name: '撰寫 HSF-001 手術紀錄' });
    fireEvent.click(recordBtn);
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/surgical-record/HSF-001'));
    expect(screen.getByTestId('loc')).not.toHaveTextContent('/lookup/HSF-001');
  });

  it('PI 可替尚未啟用的研究人員重新寄送設定密碼信', async () => {
    sb.listResearchers.mockResolvedValue([
      {
        id: 'researcher-1',
        email: 'researcher@example.com',
        display_name: '測試研究員',
        role: 'researcher',
        last_sign_in_at: null,
      },
    ]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const client = createTestQueryClient();

    render(
      <MemoryRouter initialEntries={['/researcher']}>
        <QueryClientProvider client={client}>
          <ResearcherDashboard onNavigate={() => {}} isDemo={false} userInfo={{ id: 'pi-1', role: 'pi' }} onLogout={() => {}} />
        </QueryClientProvider>
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: '重新寄送測試研究員的設定密碼信' }));

    await waitFor(() => expect(sb.resendResearcherActivation).toHaveBeenCalledWith('researcher-1'));
    expect(await screen.findByText('已提交設定密碼信到 researcher@example.com')).toBeInTheDocument();
  });
});
