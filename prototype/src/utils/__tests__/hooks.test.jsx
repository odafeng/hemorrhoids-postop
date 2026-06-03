import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Mock storage
vi.mock('../storage', () => ({
  getPOD: vi.fn().mockReturnValue(5),
  getTodayReport: vi.fn().mockReturnValue({ date: '2026-03-18', pain: 4 }),
  getAllReports: vi.fn().mockReturnValue([
    { date: '2026-03-16', pain: 3, bleeding: '無', bowel: '正常', fever: false, wound: '無異常', pod: 2 },
    { date: '2026-03-18', pain: 4, bleeding: '少量', bowel: '正常', fever: false, wound: '無異常', pod: 4 },
  ]),
  getSurgeryDate: vi.fn().mockReturnValue('2026-03-13'),
  getSurveyLocal: vi.fn().mockReturnValue(null),
}));

// Mock supabaseService
vi.mock('../supabaseService', () => ({
  getPatient: vi.fn().mockResolvedValue({ study_id: 'HEM-001', surgery_date: '2026-03-13' }),
  getPODFromDate: vi.fn().mockReturnValue(5),
  getAllReports: vi.fn().mockResolvedValue([
    { report_date: '2026-03-16', pod: 2, pain_nrs: 3, bleeding: '無', bowel: '正常', fever: false, wound: '無異常', urinary: '正常', continence: '正常' },
  ]),
  getTodayReport: vi.fn().mockResolvedValue(null),
  getAlerts: vi.fn().mockResolvedValue([]),
  getSurvey: vi.fn().mockResolvedValue(null),
  getPendingNotifications: vi.fn().mockResolvedValue([]),
}));

// Mock alerts
vi.mock('../alerts', () => ({
  checkAlerts: vi.fn().mockReturnValue([]),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

describe('useDashboardData', () => {
  it('returns demo mode data correctly', async () => {
    const { useDashboardData } = await import('../hooks');
    const { result } = renderHook(
      () => useDashboardData(true, { studyId: 'DEMO-001' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data.pod).toBe(5);
    expect(result.current.data.todayReport).toBeTruthy();
    expect(result.current.data.allReports.length).toBe(2);
    expect(result.current.data.alerts).toEqual([]);
    expect(typeof result.current.data.adherence).toBe('number');
    expect(result.current.data.surveyDone).toBe(false);
  });

  it('returns Supabase mode data correctly', async () => {
    const { useDashboardData } = await import('../hooks');
    const { result } = renderHook(
      () => useDashboardData(false, { studyId: 'HEM-001' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data.pod).toBe(5);
    expect(result.current.data.surgeryDate).toBe('2026-03-13');
    expect(result.current.data.allReports.length).toBe(1);
  });

  it('is disabled when no studyId in non-demo mode', async () => {
    const { useDashboardData } = await import('../hooks');
    const { result } = renderHook(
      () => useDashboardData(false, {}),
      { wrapper: createWrapper() },
    );
    // Query should not be enabled
    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('maps server alerts — filters acknowledged', async () => {
    const sb = await import('../supabaseService');
    sb.getAlerts.mockResolvedValue([
      { id: 1, alert_type: 'fever', alert_level: 'danger', message: 'Fever detected', acknowledged: false },
      { id: 2, alert_type: 'high_pain', alert_level: 'danger', message: 'High pain', acknowledged: true },
    ]);

    const { useDashboardData } = await import('../hooks');
    const { result } = renderHook(
      () => useDashboardData(false, { studyId: 'HEM-001' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Only unacknowledged alerts are shown
    expect(result.current.data.alerts.length).toBe(1);
    expect(result.current.data.alerts[0].title).toBe('發燒');

    // Restore
    sb.getAlerts.mockResolvedValue([]);
  });

  it('maps unknown alert types with fallback', async () => {
    const sb = await import('../supabaseService');
    sb.getAlerts.mockResolvedValue([
      { id: 1, alert_type: 'unknown_type', alert_level: 'warning', message: 'Unknown alert', acknowledged: false },
    ]);

    const { useDashboardData } = await import('../hooks');
    const { result } = renderHook(
      () => useDashboardData(false, { studyId: 'HEM-001' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data.alerts[0].title).toBe('unknown_type');

    sb.getAlerts.mockResolvedValue([]);
  });
});

describe('useHistoryData', () => {
  it('returns sorted demo reports', async () => {
    const { useHistoryData } = await import('../hooks');
    const { result } = renderHook(
      () => useHistoryData(true, { studyId: 'DEMO-001' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Should be sorted descending
    expect(result.current.data[0].date).toBe('2026-03-18');
  });

  it('returns mapped Supabase reports', async () => {
    const { useHistoryData } = await import('../hooks');
    const { result } = renderHook(
      () => useHistoryData(false, { studyId: 'HEM-001' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data[0].date).toBe('2026-03-16');
    expect(result.current.data[0].pain).toBe(3);
  });
});

describe('getExpectedReportCount', () => {
  it('returns 0 for negative POD', async () => {
    const { getExpectedReportCount } = await import('../hooks');
    expect(getExpectedReportCount(-1)).toBe(0);
  });

  it('returns correct count for POD 0-7 (daily)', async () => {
    const { getExpectedReportCount } = await import('../hooks');
    expect(getExpectedReportCount(0)).toBe(1);
    expect(getExpectedReportCount(7)).toBe(8);
  });

  it('returns correct count for POD 8-14 (every 2 days)', async () => {
    const { getExpectedReportCount } = await import('../hooks');
    const count = getExpectedReportCount(14);
    // POD 0-7: 8, POD 8,10,12,14: 4 = 12
    expect(count).toBe(12);
  });

  it('returns correct count for POD > 30 (no additional)', async () => {
    const { getExpectedReportCount } = await import('../hooks');
    const at30 = getExpectedReportCount(30);
    const at35 = getExpectedReportCount(35);
    expect(at35).toBe(at30); // no new expected after 30
  });
});

describe('calcAdherence', () => {
  it('caps at 100%', async () => {
    const { calcAdherence } = await import('../hooks');
    expect(calcAdherence(999, 1)).toBe(100);
  });

  it('calculates correct percentage', async () => {
    const { calcAdherence } = await import('../hooks');
    // POD 7: expected 8 reports
    const result = calcAdherence(4, 7);
    expect(result).toBe(50);
  });
});
