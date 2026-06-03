import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import OfflineBanner from '../OfflineBanner';

// Mock offlineQueue
vi.mock('../../utils/offlineQueue', () => ({
  getQueueCount: vi.fn().mockReturnValue(0),
}));

describe('OfflineBanner', () => {
  let mockOnLine = true;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockOnLine = true;
    Object.defineProperty(navigator, 'onLine', {
      get: () => mockOnLine,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when online', () => {
    mockOnLine = true;
    const { container } = render(<OfflineBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('shows offline banner when offline', () => {
    mockOnLine = false;
    render(<OfflineBanner />);
    expect(screen.getByText(/目前離線中/)).toBeInTheDocument();
  });

  it('shows queue count when offline with queued reports', async () => {
    mockOnLine = false;
    const { getQueueCount } = await import('../../utils/offlineQueue');
    getQueueCount.mockReturnValue(3);

    render(<OfflineBanner />);
    expect(screen.getByText(/3 筆回報已暫存/)).toBeInTheDocument();
  });

  it('shows generic message when offline with no queued reports', async () => {
    mockOnLine = false;
    const { getQueueCount } = await import('../../utils/offlineQueue');
    getQueueCount.mockReturnValue(0);

    render(<OfflineBanner />);
    expect(screen.getByText(/部分功能可能無法使用/)).toBeInTheDocument();
  });

  it('responds to online/offline events', () => {
    mockOnLine = true;
    const { container } = render(<OfflineBanner />);
    expect(container.innerHTML).toBe('');

    // Go offline
    act(() => {
      mockOnLine = false;
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText(/離線中/)).toBeInTheDocument();

    // Go online
    act(() => {
      mockOnLine = true;
      window.dispatchEvent(new Event('online'));
    });
    expect(container.innerHTML).toBe('');
  });

  it('polls queue count every 5 seconds', async () => {
    mockOnLine = false;
    const { getQueueCount } = await import('../../utils/offlineQueue');
    getQueueCount.mockReturnValue(0);

    render(<OfflineBanner />);
    expect(screen.getByText(/部分功能可能無法使用/)).toBeInTheDocument();

    // Change queue count and advance timer
    getQueueCount.mockReturnValue(2);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText(/2 筆回報已暫存/)).toBeInTheDocument();
  });
});
