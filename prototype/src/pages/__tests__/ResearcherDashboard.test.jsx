import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../../test-utils';
import ResearcherDashboard from '../ResearcherDashboard';

// Only the I/O is stubbed. getPODFromDate and friends are pure date arithmetic the
// dashboard genuinely uses; replacing them with undefined made the whole component
// throw on render, which reads as nine unrelated failures.
vi.mock('../../utils/supabaseService', async (importOriginal) => ({
  ...(await importOriginal()),
  getAllPatients: vi.fn(),
  getAdherenceSummary: vi.fn(),
  getAllAlertsForResearcher: vi.fn(),
  getUnreviewedChats: vi.fn(),
  getAllReportsForResearcher: vi.fn(),
  listStudyInvites: vi.fn(),
  listResearchers: vi.fn(),
  resetResearcherInitialPassword: vi.fn(),
  createStudyInvite: vi.fn(),
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
    sb.resetResearcherInitialPassword.mockResolvedValue({ success: true });
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

  // 被邀請信卡住的人 last_sign_in_at 是有值的——他確實登入過一次，只是那次之後
  // 再也進不來。之前這顆按鈕綁在「從未登入」上，等於對最需要它的人隱藏。
  const signedInOnceResearcher = {
    id: 'researcher-1',
    email: 'researcher@example.com',
    display_name: '測試研究員',
    role: 'researcher',
    last_sign_in_at: '2026-08-12T04:38:22.218Z',
  };

  const renderPiDashboard = () => {
    const client = createTestQueryClient();
    return render(
      <MemoryRouter initialEntries={['/researcher']}>
        <QueryClientProvider client={client}>
          <ResearcherDashboard onNavigate={() => {}} isDemo={false} userInfo={{ id: 'pi-1', role: 'pi' }} onLogout={() => {}} />
        </QueryClientProvider>
      </MemoryRouter>
    );
  };

  it('PI 可替登入過但沒有可用密碼的研究人員重設初始密碼', async () => {
    sb.listResearchers.mockResolvedValue([signedInOnceResearcher]);
    vi.spyOn(window, 'prompt').mockReturnValue('temp-pass-1234');
    renderPiDashboard();

    fireEvent.click(await screen.findByRole('button', { name: '重設測試研究員的初始密碼' }));

    await waitFor(() => expect(sb.resetResearcherInitialPassword).toHaveBeenCalledWith('researcher-1', 'temp-pass-1234'));
    expect(await screen.findByText(/已重設 researcher@example.com 的初始密碼/)).toBeInTheDocument();
  });

  it('取消輸入時不呼叫 service', async () => {
    sb.listResearchers.mockResolvedValue([signedInOnceResearcher]);
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    renderPiDashboard();

    fireEvent.click(await screen.findByRole('button', { name: '重設測試研究員的初始密碼' }));

    await waitFor(() => expect(sb.resetResearcherInitialPassword).not.toHaveBeenCalled());
  });

  // 送出去只會拿到 Edge Function 的 400，白跑一趟還多一次 service_role 呼叫。
  it('太短的密碼在前端就擋下，不打 service', async () => {
    sb.listResearchers.mockResolvedValue([signedInOnceResearcher]);
    vi.spyOn(window, 'prompt').mockReturnValue('short');
    renderPiDashboard();

    fireEvent.click(await screen.findByRole('button', { name: '重設測試研究員的初始密碼' }));

    expect(await screen.findByText('初始密碼至少需要 8 個字元')).toBeInTheDocument();
    expect(sb.resetResearcherInitialPassword).not.toHaveBeenCalled();
  });

  // 有效期是研究層級的參數，不是逐案決策。把它留在收案動線上只是多一個能填錯的
  // 欄位，而且填錯的代價會在病床邊、病人註冊失敗時才浮現。
  it('產生邀請碼時不詢問有效期，也不把天數傳給 service', async () => {
    sb.createStudyInvite.mockResolvedValue({
      study_id: 'HSF-011',
      invite_token: 'ABCDEF',
      status: 'pending',
      expires_at: '2027-12-31T15:59:59.000Z',
    });
    const client = createTestQueryClient();

    render(
      <MemoryRouter initialEntries={['/researcher']}>
        <QueryClientProvider client={client}>
          <ResearcherDashboard onNavigate={() => {}} isDemo={false} userInfo={{ id: 'pi-1', role: 'pi' }} onLogout={() => {}} />
        </QueryClientProvider>
      </MemoryRouter>
    );

    // 先等收案卡片掛載再斷言欄位不存在。緊接著 render() 查詢的話，命中的是尚未
    // 載入完成的畫面，這條斷言就會恆真而失去保護力。
    const numInput = await screen.findByPlaceholderText('編號 001');
    expect(screen.queryByText('有效天數')).not.toBeInTheDocument();

    fireEvent.change(numInput, { target: { value: '11' } });
    fireEvent.click(screen.getByRole('button', { name: /產生邀請碼/ }));

    await waitFor(() => expect(sb.createStudyInvite).toHaveBeenCalledWith('HSF-011'));
  });
});

describe('ResearcherDashboard — 統計數字排除測試帳號', () => {
  // TEST-001 是 e2e 用的常駐帳號，它不回報症狀，依從率永遠是 0%。留在分母裡
  // 會把整體依從率往下拉，而且它的 expected_reports 逐日增加，誤差只會擴大。
  beforeEach(() => {
    vi.clearAllMocks();
    sb.getAllPatients.mockResolvedValue([
      { study_id: 'HSF-001', surgeon_id: 'HSF', study_status: 'active', surgery_date: '2026-07-24' },
      { study_id: 'HSF-002', surgeon_id: 'HSF', study_status: 'active', surgery_date: '2026-08-08' },
      { study_id: 'WCC-001', surgeon_id: 'WCC', study_status: 'active', surgery_date: '2026-08-05' },
      { study_id: 'WCC-002', surgeon_id: 'WCC', study_status: 'active', surgery_date: '2026-08-05' },
      { study_id: 'TEST-001', surgeon_id: 'TEST', study_status: 'active', surgery_date: '2026-07-18' },
    ]);
    sb.getAdherenceSummary.mockResolvedValue([
      { study_id: 'HSF-001', adherence_pct: 100 },
      { study_id: 'HSF-002', adherence_pct: 100 },
      { study_id: 'WCC-001', adherence_pct: 100 },
      { study_id: 'WCC-002', adherence_pct: 100 },
      { study_id: 'TEST-001', adherence_pct: 0 },
    ]);
    sb.getAllAlertsForResearcher.mockResolvedValue([]);
    sb.getUnreviewedChats.mockResolvedValue([]);
    sb.getAllReportsForResearcher.mockResolvedValue([]);
    sb.listStudyInvites.mockResolvedValue([]);
    sb.listResearchers.mockResolvedValue([]);
  });

  const renderDashboard = () => {
    const client = createTestQueryClient();
    return render(
      <MemoryRouter initialEntries={['/researcher']}>
        <QueryClientProvider client={client}>
          <ResearcherDashboard onNavigate={() => {}} isDemo={false} userInfo={{ role: 'pi' }} onLogout={() => {}} />
        </QueryClientProvider>
      </MemoryRouter>
    );
  };

  const statValue = (label) =>
    screen.getByText(label).closest('.stat-card').querySelector('.stat-val').textContent;

  it('ENROLLED 不計入 TEST-001', async () => {
    renderDashboard();
    await screen.findByText('HSF-001');
    expect(statValue('ENROLLED')).toBe('4');
  });

  it('ENROLLED 是累計收案，結案不會讓它往下掉', async () => {
    // 結案機制上線前 study_status 只有 'active'，這個數字放累計或放在追蹤中
    // 完全看不出差別。收滿 50 例並全部追蹤完成時，舊寫法會顯示 0。
    sb.getAllPatients.mockResolvedValue([
      { study_id: 'HSF-001', surgeon_id: 'HSF', study_status: 'completed', surgery_date: '2026-07-24' },
      { study_id: 'HSF-002', surgeon_id: 'HSF', study_status: 'active', surgery_date: '2026-08-08' },
      { study_id: 'WCC-001', surgeon_id: 'WCC', study_status: 'withdrawn', surgery_date: '2026-08-05' },
      { study_id: 'TEST-001', surgeon_id: 'TEST', study_status: 'active', surgery_date: '2026-07-18' },
    ]);
    renderDashboard();
    await screen.findByText('HSF-001');
    expect(statValue('ENROLLED')).toBe('3');
  });

  it('ENROLLED 的小字報出目標與仍在追蹤的人數', async () => {
    sb.getAllPatients.mockResolvedValue([
      { study_id: 'HSF-001', surgeon_id: 'HSF', study_status: 'completed', surgery_date: '2026-07-24' },
      { study_id: 'HSF-002', surgeon_id: 'HSF', study_status: 'active', surgery_date: '2026-08-08' },
    ]);
    renderDashboard();
    await screen.findByText('HSF-001');
    const foot = screen.getByText('ENROLLED').closest('.stat-card').querySelector('.stat-foot');
    expect(foot.textContent).toContain('50');
    expect(foot.textContent).toContain('追蹤中 1');
  });

  it('ADHERENCE 不把 TEST-001 的 0% 算進分母', async () => {
    renderDashboard();
    await screen.findByText('HSF-001');
    // 四名真實受試者都是 100%；含 TEST-001 會算成 80.0%
    expect(statValue('ADHERENCE')).toContain('100.0');
  });

  it('TEST-001 仍出現在收案列表中', async () => {
    // e2e/researcher-flow.spec.ts 會搜尋並斷言 TEST-001 可見。
    // 統計要排除它，列表不能連帶把它藏起來。
    renderDashboard();
    expect(await screen.findByText('TEST-001')).toBeInTheDocument();
  });
});

describe('ResearcherDashboard — 已確認的警示收合', () => {
  // 11 則警示、全部已確認，是 2026-08-29 production 的實際狀態。攤開來就是
  // 一整頁已解決的卡片，而且只會隨收案數成長。
  const alert = (id, acknowledged) => ({
    id, study_id: 'HSF-002', alert_type: 'pain_high', alert_level: 'warning',
    message: `警示 ${id}`, triggered_at: '2026-08-27T10:00:00Z', acknowledged,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    sb.getAllPatients.mockResolvedValue([
      { study_id: 'HSF-002', surgeon_id: 'HSF', study_status: 'active', surgery_date: '2026-08-08' },
    ]);
    sb.getAdherenceSummary.mockResolvedValue([]);
    sb.getUnreviewedChats.mockResolvedValue([]);
    sb.getAllReportsForResearcher.mockResolvedValue([]);
    sb.listStudyInvites.mockResolvedValue([]);
    sb.listResearchers.mockResolvedValue([]);
  });

  const renderDashboard = () => {
    const client = createTestQueryClient();
    return render(
      <MemoryRouter initialEntries={['/researcher']}>
        <QueryClientProvider client={client}>
          <ResearcherDashboard onNavigate={() => {}} isDemo={false} userInfo={{ role: 'pi' }} onLogout={() => {}} />
        </QueryClientProvider>
      </MemoryRouter>
    );
  };

  it('已確認的警示預設不渲染，只留一行收合開關', async () => {
    sb.getAllAlertsForResearcher.mockResolvedValue([alert('a1', true), alert('a2', true)]);
    renderDashboard();
    expect(await screen.findByRole('button', { name: /展開已確認 2 則/ })).toBeInTheDocument();
    // 條件渲染而非 <details>：收合時元素真的不在 DOM 裡，jsdom 分辨得出來。
    expect(screen.queryByText('警示 a1')).not.toBeInTheDocument();
    expect(screen.queryByText('警示 a2')).not.toBeInTheDocument();
  });

  it('點開之後已確認的才出現，再點收回去', async () => {
    sb.getAllAlertsForResearcher.mockResolvedValue([alert('a1', true)]);
    renderDashboard();
    const toggle = await screen.findByRole('button', { name: /展開已確認 1 則/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(await screen.findByText('警示 a1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /收合已確認 1 則/ })).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByRole('button', { name: /收合已確認 1 則/ }));
    expect(screen.queryByText('警示 a1')).not.toBeInTheDocument();
  });

  it('未確認的一律展開，不受收合開關影響', async () => {
    sb.getAllAlertsForResearcher.mockResolvedValue([alert('new', false), alert('old', true)]);
    renderDashboard();
    expect(await screen.findByText('警示 new')).toBeInTheDocument();
    expect(screen.queryByText('警示 old')).not.toBeInTheDocument();
    expect(screen.getByText(/1 UNACKED/)).toBeInTheDocument();
  });

  it('沒有已確認的警示時不出現收合開關', async () => {
    sb.getAllAlertsForResearcher.mockResolvedValue([alert('new', false)]);
    renderDashboard();
    await screen.findByText('警示 new');
    expect(screen.queryByRole('button', { name: /已確認/ })).not.toBeInTheDocument();
  });
});
