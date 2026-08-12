import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NotificationSetup from '../NotificationSetup';

// Mock notifications utils
vi.mock('../../utils/notifications', () => ({
  isNotificationSupported: vi.fn().mockReturnValue(true),
  getNotificationStatus: vi.fn().mockReturnValue('default'),
  requestPermission: vi.fn().mockResolvedValue('granted'),
  isNotificationsEnabled: vi.fn().mockReturnValue(false),
  setNotificationsEnabled: vi.fn(),
  getReminderTime: vi.fn().mockReturnValue({ hour: 20, minute: 0 }),
  setReminderTime: vi.fn(),
  showReminderNotification: vi.fn(),
}));

// Mock supabaseService
vi.mock('../../utils/supabaseService', () => ({
  getNotifPrefs: vi.fn().mockResolvedValue(null),
  upsertNotifPrefs: vi.fn().mockResolvedValue({}),
  savePushSubscription: vi.fn().mockResolvedValue({}),
  removePushSubscription: vi.fn().mockResolvedValue({}),
  sendTestPush: vi.fn().mockResolvedValue({ ok: true, sent: 1, failed: 0 }),
}));

describe('NotificationSetup', () => {
  const defaultProps = {
    studyId: 'HEM-001',
    isDemo: true,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset notification mocks to default state
    const notif = await import('../../utils/notifications');
    notif.isNotificationSupported.mockReturnValue(true);
    notif.getNotificationStatus.mockReturnValue('default');
    notif.isNotificationsEnabled.mockReturnValue(false);
    notif.getReminderTime.mockReturnValue({ hour: 20, minute: 0 });
  });

  it('returns null when notifications not supported', async () => {
    const notif = await import('../../utils/notifications');
    notif.isNotificationSupported.mockReturnValue(false);
    const { container } = render(<NotificationSetup {...defaultProps} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows blocked message when permission is denied', async () => {
    const notif = await import('../../utils/notifications');
    notif.getNotificationStatus.mockReturnValue('denied');
    render(<NotificationSetup {...defaultProps} />);
    expect(screen.getByText('通知已被封鎖')).toBeInTheDocument();
    expect(screen.getByText(/請至瀏覽器設定中重新開啟/)).toBeInTheDocument();
  });

  it('renders toggle button in default state', () => {
    render(<NotificationSetup {...defaultProps} />);
    expect(screen.getByText('回報提醒')).toBeInTheDocument();
    expect(screen.getByLabelText('開啟通知')).toBeInTheDocument();
  });

  it('shows description when notifications are off', () => {
    render(<NotificationSetup {...defaultProps} />);
    expect(screen.getByText(/開啟後，需回報的日子/)).toBeInTheDocument();
  });

  // The reminder time selects only drive the in-app scheduler; server push runs from
  // cron-notify.yml at fixed hours and never reads notification_preferences. The copy
  // used to promise a push at whatever time the patient picked, which was never true.
  it('states the fixed server push hours, not the patient-selected time', async () => {
    const notif = await import('../../utils/notifications');
    notif.isNotificationsEnabled.mockReturnValue(true);
    notif.getNotificationStatus.mockReturnValue('granted');
    notif.getReminderTime.mockReturnValue({ hour: 8, minute: 30 });

    render(<NotificationSetup {...defaultProps} />);

    expect(screen.getByText(/伺服器推播固定於中午 12:00 與晚上 20:00/)).toBeInTheDocument();
    expect(screen.getByText(/此時間只在 App 開著時生效/)).toBeInTheDocument();
    // 08:30 is the patient's pick — it must not be presented as when a push arrives.
    expect(screen.queryByText(/每天 08:30/)).not.toBeInTheDocument();
  });

  it('toggles notifications on — requests permission and enables', async () => {
    const notif = await import('../../utils/notifications');
    render(<NotificationSetup {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('開啟通知'));

    await waitFor(() => {
      expect(notif.requestPermission).toHaveBeenCalled();
      expect(notif.setNotificationsEnabled).toHaveBeenCalledWith(true);
    });
  });

  it('does not enable if permission request is denied', async () => {
    const notif = await import('../../utils/notifications');
    notif.requestPermission.mockResolvedValue('denied');
    render(<NotificationSetup {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('開啟通知'));

    await waitFor(() => {
      expect(notif.requestPermission).toHaveBeenCalled();
    });
    // Should not have been called with true
    expect(notif.setNotificationsEnabled).not.toHaveBeenCalledWith(true);
  });

  it('skips permission request when already granted', async () => {
    const notif = await import('../../utils/notifications');
    notif.getNotificationStatus.mockReturnValue('granted');
    render(<NotificationSetup {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('開啟通知'));

    await waitFor(() => {
      expect(notif.requestPermission).not.toHaveBeenCalled();
      expect(notif.setNotificationsEnabled).toHaveBeenCalledWith(true);
    });
  });

  it('shows time input and test button when enabled', async () => {
    const notif = await import('../../utils/notifications');
    notif.isNotificationsEnabled.mockReturnValue(true);
    notif.getNotificationStatus.mockReturnValue('granted');

    render(<NotificationSetup {...defaultProps} />);

    // Already enabled — should show time selects and test button
    expect(screen.getByLabelText('提醒小時 (24 小時制)')).toBeInTheDocument();
    expect(screen.getByLabelText('提醒分鐘')).toBeInTheDocument();
    expect(screen.getByText(/測試通知/)).toBeInTheDocument();
  });

  it('toggles off — disables notifications', async () => {
    const notif = await import('../../utils/notifications');
    notif.isNotificationsEnabled.mockReturnValue(true);
    notif.getNotificationStatus.mockReturnValue('granted');

    render(<NotificationSetup {...defaultProps} />);

    // Click toggle (which should be "關閉通知" since enabled)
    const toggle = screen.getByLabelText('關閉通知');
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(notif.setNotificationsEnabled).toHaveBeenCalledWith(false);
    });
  });

  it('handles time change via hour + minute selects', async () => {
    const notif = await import('../../utils/notifications');
    notif.isNotificationsEnabled.mockReturnValue(true);
    notif.getNotificationStatus.mockReturnValue('granted');

    render(<NotificationSetup {...defaultProps} />);

    // New UI replaces <input type="time"> with two <select>s to avoid
    // the Samsung Android native picker bug that displays 19:30 as 7:30.
    const hourSelect = screen.getByLabelText('提醒小時 (24 小時制)');
    const minuteSelect = screen.getByLabelText('提醒分鐘');

    fireEvent.change(hourSelect, { target: { value: '8' } });
    expect(notif.setReminderTime).toHaveBeenCalledWith(8, 0); // minute unchanged from default 0

    notif.setReminderTime.mockClear();

    fireEvent.change(minuteSelect, { target: { value: '30' } });
    expect(notif.setReminderTime).toHaveBeenCalledWith(8, 30);
  });

  it('test notification button calls server-sent push (sendTestPush)', async () => {
    const notif = await import('../../utils/notifications');
    notif.isNotificationsEnabled.mockReturnValue(true);
    notif.getNotificationStatus.mockReturnValue('granted');
    const sb = await import('../../utils/supabaseService');

    // isDemo=false + already-subscribed push so the button hits the server path
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({
          pushManager: {
            // Deliberately slow: resolving immediately let the assertion below pass
            // whether or not it waited for the subscribed state, so the ordering bug
            // this test guards was only visible on a loaded CI runner. The delay makes
            // that ordering deterministic here.
            getSubscription: vi.fn().mockImplementation(
              () => new Promise((r) => setTimeout(() => r({ endpoint: 'https://fcm.example' }), 40)),
            ),
          },
        }),
      },
      configurable: true,
    });

    render(<NotificationSetup studyId="HEM-001" isDemo={false} />);

    // Wait for pushStatus to actually reach 'subscribed'. The button renders before
    // the getSubscription() promise resolves, so waiting on the button alone let the
    // click land early on a loaded runner — the handler then takes its `no-sub`
    // bail-out and sendTestPush is never called. '推播已開啟' only renders in the
    // subscribed state, so it is the observable signal this test always meant to use.
    await waitFor(() => expect(screen.getByText(/推播已開啟/)).toBeInTheDocument());

    fireEvent.click(screen.getByText(/測試通知/));

    await waitFor(() => {
      expect(sb.sendTestPush).toHaveBeenCalled();
    });
    // The local showReminderNotification path is no longer used — the button
    // now goes through the production FCM push path via the Edge Function.
    expect(notif.showReminderNotification).not.toHaveBeenCalled();
  });

  it('loads server prefs on mount for non-demo mode', async () => {
    const sb = await import('../../utils/supabaseService');
    sb.getNotifPrefs.mockResolvedValue({ enabled: true, hour: 9, minute: 15 });

    // Mock serviceWorker for checkPushSubscription
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: Promise.resolve({ pushManager: { getSubscription: vi.fn().mockResolvedValue(null) } }) },
      configurable: true,
    });

    render(<NotificationSetup studyId="HEM-001" isDemo={false} />);

    await waitFor(() => {
      expect(sb.getNotifPrefs).toHaveBeenCalledWith('HEM-001');
    });
  });

  it('syncs to server on toggle for non-demo mode', async () => {
    const notif = await import('../../utils/notifications');
    notif.getNotificationStatus.mockReturnValue('granted');
    const sb = await import('../../utils/supabaseService');

    render(<NotificationSetup studyId="HEM-001" isDemo={false} />);

    fireEvent.click(screen.getByLabelText('開啟通知'));

    await waitFor(() => {
      expect(sb.upsertNotifPrefs).toHaveBeenCalled();
    });
  });

  it('shows push status when subscribed', async () => {
    const notif = await import('../../utils/notifications');
    notif.isNotificationsEnabled.mockReturnValue(true);
    notif.getNotificationStatus.mockReturnValue('granted');

    render(<NotificationSetup {...defaultProps} />);
    // Status badge should show something
  });
});
