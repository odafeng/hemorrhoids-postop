import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  enqueueReport,
  getQueuedReports,
  removeFromQueue,
  getQueueCount,
  flushQueue,
  clearQueue,
} from '../offlineQueue';

// crypto.randomUUID is used inside enqueueReport
vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'uuid-1') });

describe('offlineQueue', () => {
  beforeEach(() => {
    localStorage.clear();
    crypto.randomUUID.mockReset();
    crypto.randomUUID
      .mockReturnValueOnce('uuid-1')
      .mockReturnValueOnce('uuid-2')
      .mockReturnValueOnce('uuid-3');
  });

  // ---------- enqueueReport ----------
  describe('enqueueReport', () => {
    it('adds an item to the localStorage queue', () => {
      enqueueReport('S001', 2, { pain: 3 });

      const stored = JSON.parse(localStorage.getItem('offline_report_queue'));
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        studyId: 'S001',
        pod: 2,
        report: { pain: 3 },
        id: 'uuid-1',
      });
      expect(stored[0].queuedAt).toBeDefined();
    });

    it('accumulates multiple enqueues', () => {
      enqueueReport('S001', 1, { pain: 1 });
      enqueueReport('S002', 3, { pain: 5 });

      const stored = getQueuedReports();
      expect(stored).toHaveLength(2);
      expect(stored[0].id).toBe('uuid-1');
      expect(stored[1].id).toBe('uuid-2');
    });
  });

  // ---------- getQueuedReports ----------
  describe('getQueuedReports', () => {
    it('returns empty array when nothing is stored', () => {
      expect(getQueuedReports()).toEqual([]);
    });

    it('returns the stored queue', () => {
      enqueueReport('S001', 0, { bleeding: false });
      const queue = getQueuedReports();
      expect(queue).toHaveLength(1);
      expect(queue[0].studyId).toBe('S001');
    });

    it('returns empty array when localStorage contains corrupt data', () => {
      localStorage.setItem('offline_report_queue', '<<<not json>>>');
      expect(getQueuedReports()).toEqual([]);
    });
  });

  // ---------- removeFromQueue ----------
  describe('removeFromQueue', () => {
    it('removes an item by id', () => {
      enqueueReport('S001', 1, { pain: 1 });
      enqueueReport('S002', 2, { pain: 2 });

      removeFromQueue('uuid-1');

      const queue = getQueuedReports();
      expect(queue).toHaveLength(1);
      expect(queue[0].id).toBe('uuid-2');
    });

    it('does nothing when id does not exist', () => {
      enqueueReport('S001', 1, { pain: 1 });
      removeFromQueue('nonexistent');
      expect(getQueuedReports()).toHaveLength(1);
    });
  });

  // ---------- getQueueCount ----------
  describe('getQueueCount', () => {
    it('returns 0 for empty queue', () => {
      expect(getQueueCount()).toBe(0);
    });

    it('returns the number of queued items', () => {
      enqueueReport('S001', 1, {});
      enqueueReport('S002', 2, {});
      expect(getQueueCount()).toBe(2);
    });
  });

  // ---------- flushQueue ----------
  describe('flushQueue', () => {
    it('returns {flushed:0, failed:0} for empty queue', async () => {
      const result = await flushQueue(vi.fn());
      expect(result).toEqual({ flushed: 0, failed: 0, errors: [] });
    });

    it('calls saveReportFn for each item and removes successful ones', async () => {
      enqueueReport('S001', 1, { pain: 1 });
      enqueueReport('S002', 2, { pain: 2 });

      const saveFn = vi.fn().mockResolvedValue(undefined);
      const result = await flushQueue(saveFn);

      expect(saveFn).toHaveBeenCalledTimes(2);
      expect(saveFn).toHaveBeenCalledWith('S001', 1, { pain: 1 });
      expect(saveFn).toHaveBeenCalledWith('S002', 2, { pain: 2 });
      expect(result).toEqual({ flushed: 2, failed: 0, errors: [] });
      expect(getQueueCount()).toBe(0);
    });

    it('counts failed items and leaves them in the queue', async () => {
      enqueueReport('S001', 1, { pain: 1 });
      enqueueReport('S002', 2, { pain: 2 });
      enqueueReport('S003', 3, { pain: 3 });

      const saveFn = vi.fn()
        .mockResolvedValueOnce(undefined)   // S001 succeeds
        .mockRejectedValueOnce(new Error()) // S002 fails
        .mockResolvedValueOnce(undefined);  // S003 succeeds

      const result = await flushQueue(saveFn);

      expect(result.flushed).toBe(2);
      expect(result.failed).toBe(1);
      // Only the failed item remains
      const remaining = getQueuedReports();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].studyId).toBe('S002');
    });

    // The patient was already shown a success tick when the report was queued,
    // so a stuck item is a report they believe was submitted. The caller can
    // only warn them if flushQueue actually says which ones failed.
    it('reports which items failed so the caller can surface them', async () => {
      enqueueReport('S001', 1, { pain: 1 }, '2026-07-20');
      enqueueReport('S002', 2, { pain: 9, fever: true }, '2026-07-21');

      const saveFn = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('new row violates row-level security policy'));

      const result = await flushQueue(saveFn);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        studyId: 'S002',
        reportDate: '2026-07-21',
        pod: 2,
        message: expect.stringContaining('row-level security'),
      });
    });

    it('records attempt count on a stuck item so repeated failures are diagnosable', async () => {
      enqueueReport('S001', 1, { pain: 1 });
      const saveFn = vi.fn().mockRejectedValue(new Error('boom'));

      await flushQueue(saveFn);
      await flushQueue(saveFn);

      const [stuck] = getQueuedReports();
      expect(stuck.attempts).toBe(2);
      expect(stuck.lastError).toBe('boom');
    });

    it('clearQueue drops everything (logout on a shared clinic device)', async () => {
      enqueueReport('S001', 1, { pain: 1 });
      enqueueReport('S002', 2, { pain: 2 });
      expect(getQueueCount()).toBe(2);

      clearQueue();

      expect(getQueueCount()).toBe(0);
    });
  });
});
