import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSurgeryDate,
  setSurgeryDate,
  getPOD,
  getAllReports,
  getTodayReport,
  saveReport,
  getReportsForLastNDays,
  getChatHistory,
  saveChatMessage,
  clearAllData,
  seedDemoData,
  getSurveyLocal,
  saveSurveyLocal,
  getResearcherMockData,
} from '../storage';

// Freeze "today" for deterministic tests
const FIXED_TODAY = '2026-03-18';

describe('storage utils', () => {
  beforeEach(() => {
    // Mock Date to always return our fixed date
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${FIXED_TODAY}T10:00:00`));
  });

  afterEach(() => { // eslint-disable-line no-undef
    vi.useRealTimers();
  });

  // === Surgery Date ===
  describe('surgeryDate', () => {
    it('defaults to today when not set', () => {
      const date = getSurgeryDate();
      expect(date).toBe(FIXED_TODAY);
    });

    it('stores and retrieves custom date', () => {
      setSurgeryDate('2026-03-13');
      expect(getSurgeryDate()).toBe('2026-03-13');
    });
  });

  // === POD ===
  describe('getPOD', () => {
    it('returns 0 when surgery date is today', () => {
      setSurgeryDate(FIXED_TODAY);
      expect(getPOD()).toBe(0);
    });

    it('returns correct POD for past surgery date', () => {
      setSurgeryDate('2026-03-13');
      expect(getPOD()).toBe(5); // 18 - 13 = 5
    });

    it('returns 0 for future surgery date (clamped)', () => {
      setSurgeryDate('2026-03-20');
      expect(getPOD()).toBe(0);
    });
  });

  // === Reports ===
  describe('reports', () => {
    it('getAllReports returns empty array initially', () => {
      expect(getAllReports()).toEqual([]);
    });

    it('saveReport stores and getTodayReport retrieves', () => {
      const report = { pain: 5, bleeding: '少量', bowel: '正常', fever: false, wound: '無異常' };
      const saved = saveReport(report);
      expect(saved.date).toBe(FIXED_TODAY);
      expect(saved.pain).toBe(5);
      expect(saved.bleeding).toBe('少量');

      const today = getTodayReport();
      expect(today).not.toBeNull();
      expect(today.pain).toBe(5);
    });

    it('saveReport upserts same-day report', () => {
      saveReport({ pain: 3, bleeding: '無', bowel: '正常', fever: false, wound: '無異常' });
      saveReport({ pain: 7, bleeding: '少量', bowel: '困難', fever: false, wound: '腫脹' });
      const all = getAllReports();
      expect(all.length).toBe(1);
      expect(all[0].pain).toBe(7); // updated value
    });

    it('getTodayReport returns null when no report today', () => {
      expect(getTodayReport()).toBeNull();
    });

    it('getAllReports returns all stored reports', () => {
      // Manually inject multi-day data
      const reports = [
        { date: '2026-03-16', pain: 4, bleeding: '無', bowel: '正常', fever: false, wound: '無異常', pod: 0, timestamp: '2026-03-16T10:00:00Z' },
        { date: '2026-03-17', pain: 6, bleeding: '少量', bowel: '困難', fever: false, wound: '腫脹', pod: 1, timestamp: '2026-03-17T10:00:00Z' },
      ];
      localStorage.setItem('hemorrhoid_reports', JSON.stringify(reports));
      expect(getAllReports().length).toBe(2);
    });
  });

  // === Reports for Last N Days ===
  describe('getReportsForLastNDays', () => {
    it('filters reports within the N-day window', () => {
      const reports = [
        { date: '2026-03-10', pain: 2, pod: 0, timestamp: '' },
        { date: '2026-03-16', pain: 4, pod: 6, timestamp: '' },
        { date: '2026-03-18', pain: 5, pod: 8, timestamp: '' },
      ];
      localStorage.setItem('hemorrhoid_reports', JSON.stringify(reports));
      const last3 = getReportsForLastNDays(3);
      expect(last3.length).toBe(2); // 03-16 and 03-18
      expect(last3[0].date).toBe('2026-03-16'); // sorted ascending
    });
  });

  // === Chat History ===
  describe('chat history', () => {
    it('getChatHistory returns empty array initially', () => {
      expect(getChatHistory()).toEqual([]);
    });

    it('saveChatMessage appends with timestamp', () => {
      saveChatMessage({ role: 'user', text: '痛怎麼辦' });
      saveChatMessage({ role: 'ai', text: '建議溫水坐浴...' });
      const history = getChatHistory();
      expect(history.length).toBe(2);
      expect(history[0].role).toBe('user');
      expect(history[0].timestamp).toBeDefined();
      expect(history[1].role).toBe('ai');
    });
  });

  // === Clear All ===
  describe('clearAllData', () => {
    it('removes all storage keys', () => {
      saveReport({ pain: 5, bleeding: '無', bowel: '正常', fever: false, wound: '無異常' });
      saveChatMessage({ role: 'user', text: 'test' });
      clearAllData();
      expect(getAllReports()).toEqual([]);
      expect(getChatHistory()).toEqual([]);
    });
  });

  // === Survey ===
  describe('survey', () => {
    it('getSurveyLocal returns null initially', () => {
      expect(getSurveyLocal()).toBeNull();
    });

    it('saveSurveyLocal stores and retrieves survey', () => {
      const survey = { q1: 5, q2: 4, comments: 'Good' };
      const saved = saveSurveyLocal(survey);
      expect(saved.q1).toBe(5);
      expect(saved.date).toBe(FIXED_TODAY);
      expect(saved.timestamp).toBeDefined();
      expect(getSurveyLocal()).not.toBeNull();
      expect(getSurveyLocal().q1).toBe(5);
    });
  });

  // === Researcher Mock Data ===
  describe('getResearcherMockData', () => {
    it('returns all mock data structures', () => {
      const data = getResearcherMockData();
      expect(data.patients.length).toBe(4);
      expect(data.adherence.length).toBe(4);
      expect(data.alerts.length).toBe(3);
      expect(data.chatLogs.length).toBe(5);
      expect(data.reports.length).toBeGreaterThan(0);
    });

    it('patients have required fields', () => {
      const { patients } = getResearcherMockData();
      for (const p of patients) {
        expect(p.study_id).toBeTruthy();
        expect(p.surgery_date).toBeTruthy();
        expect(p.study_status).toBe('active');
      }
    });

    it('reports have all expected fields', () => {
      const { reports } = getResearcherMockData();
      for (const r of reports) {
        expect(r.study_id).toBeTruthy();
        expect(typeof r.pod).toBe('number');
        expect(typeof r.pain_nrs).toBe('number');
      }
    });

    it('adherence data has correct structure', () => {
      const { adherence } = getResearcherMockData();
      for (const a of adherence) {
        expect(a.study_id).toBeTruthy();
        expect(typeof a.total_reports).toBe('number');
        expect(typeof a.adherence_pct).toBe('number');
      }
    });
  });

  // === Seed Demo Data ===
  describe('seedDemoData', () => {
    it('creates demo reports and sets surgery date', () => {
      seedDemoData();
      const reports = getAllReports();
      expect(reports.length).toBe(5);
      const sd = getSurgeryDate();
      expect(sd).toBe('2026-03-13'); // 5 days ago from 03-18
    });

    it('does not overwrite existing reports', () => {
      saveReport({ pain: 1, bleeding: '無', bowel: '正常', fever: false, wound: '無異常' });
      seedDemoData();
      const reports = getAllReports();
      expect(reports.length).toBe(1); // original report, not seeded
    });
  });
});
