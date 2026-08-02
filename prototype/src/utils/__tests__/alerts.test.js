import { describe, it, expect } from 'vitest';
import { checkAlerts, getAlertLevel } from '../alerts';

// Helper to create a report entry
const makeReport = (overrides = {}) => ({
  date: '2026-03-18',
  pain: 3,
  bleeding: '無',
  bowel: '正常',
  fever: false,
  wound: '無異常',
  ...overrides,
});

// Generate consecutive dates counting backwards from today
const makeConsecutiveDates = (n) => {
  const dates = [];
  for (let i = 0; i < n; i++) {
    const d = new Date('2026-03-18');
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
};

describe('checkAlerts', () => {
  it('returns empty array for no reports', () => {
    expect(checkAlerts([])).toEqual([]);
    expect(checkAlerts(null)).toEqual([]);
    expect(checkAlerts(undefined)).toEqual([]);
  });

  it('returns empty array when all symptoms are normal', () => {
    const dates = makeConsecutiveDates(5);
    const reports = dates.map(date => makeReport({ date }));
    expect(checkAlerts(reports)).toEqual([]);
  });

  // === Pain Alerts ===
  describe('pain alerts', () => {
    it('triggers high pain alert for 3+ consecutive days with pain >= 8', () => {
      const dates = makeConsecutiveDates(4);
      const reports = dates.map(date => makeReport({ date, pain: 9 }));
      const alerts = checkAlerts(reports);
      expect(alerts.some(a => a.id === 'high_pain')).toBe(true);
      expect(alerts.find(a => a.id === 'high_pain').type).toBe('danger');
    });

    it('does NOT trigger for only 2 consecutive days with pain >= 8', () => {
      const dates = makeConsecutiveDates(3);
      const reports = [
        makeReport({ date: dates[0], pain: 9 }),
        makeReport({ date: dates[1], pain: 8 }),
        makeReport({ date: dates[2], pain: 5 }), // breaks the streak
      ];
      const alerts = checkAlerts(reports);
      expect(alerts.some(a => a.id === 'high_pain')).toBe(false);
    });

    it('does NOT trigger when pain is exactly 7 (below threshold)', () => {
      const dates = makeConsecutiveDates(5);
      const reports = dates.map(date => makeReport({ date, pain: 7 }));
      expect(checkAlerts(reports).some(a => a.id === 'high_pain')).toBe(false);
    });
  });

  // === Bleeding Alerts ===
  describe('bleeding alerts', () => {
    it('triggers persistent bleeding alert for 2+ consecutive "持續" reports', () => {
      const dates = makeConsecutiveDates(2);
      const reports = dates.map(date => makeReport({ date, bleeding: '持續' }));
      const alerts = checkAlerts(reports);
      expect(alerts.some(a => a.id === 'persistent_bleeding')).toBe(true);
    });

    it('does NOT trigger persistent bleeding for single "持續" report', () => {
      const reports = [makeReport({ date: '2026-03-18', bleeding: '持續' })];
      const alerts = checkAlerts(reports);
      expect(alerts.some(a => a.id === 'persistent_bleeding')).toBe(false);
    });

    it('triggers blood clot alert for latest report "血塊"', () => {
      const reports = [makeReport({ date: '2026-03-18', bleeding: '血塊' })];
      const alerts = checkAlerts(reports);
      expect(alerts.some(a => a.id === 'blood_clot')).toBe(true);
    });

    it('does NOT trigger for "少量" bleeding', () => {
      const reports = [makeReport({ date: '2026-03-18', bleeding: '少量' })];
      const alerts = checkAlerts(reports);
      expect(alerts.some(a => a.id === 'persistent_bleeding')).toBe(false);
      expect(alerts.some(a => a.id === 'blood_clot')).toBe(false);
    });
  });

  // === Bowel Alerts ===
  describe('bowel alerts', () => {
    it('triggers no-bowel alert for 3+ consecutive days with "未排"', () => {
      const dates = makeConsecutiveDates(3);
      const reports = dates.map(date => makeReport({ date, bowel: '未排' }));
      const alerts = checkAlerts(reports);
      expect(alerts.some(a => a.id === 'no_bowel')).toBe(true);
      expect(alerts.find(a => a.id === 'no_bowel').type).toBe('warning');
    });

    it('does NOT trigger for only 2 days of "未排"', () => {
      const dates = makeConsecutiveDates(3);
      const reports = [
        makeReport({ date: dates[0], bowel: '未排' }),
        makeReport({ date: dates[1], bowel: '未排' }),
        makeReport({ date: dates[2], bowel: '正常' }),
      ];
      expect(checkAlerts(reports).some(a => a.id === 'no_bowel')).toBe(false);
    });
  });

  // === Fever Alerts ===
  describe('fever alerts', () => {
    it('triggers fever alert when latest report has fever', () => {
      const reports = [makeReport({ date: '2026-03-18', fever: true })];
      const alerts = checkAlerts(reports);
      expect(alerts.some(a => a.id === 'fever')).toBe(true);
      expect(alerts.find(a => a.id === 'fever').type).toBe('danger');
    });

    it('does NOT trigger fever alert when no fever', () => {
      const reports = [makeReport({ date: '2026-03-18', fever: false })];
      expect(checkAlerts(reports).some(a => a.id === 'fever')).toBe(false);
    });
  });

  // === Ascending Pain ===
  describe('ascending pain alerts', () => {
    it('triggers ascending pain for 3 consecutive increasing days', () => {
      const dates = makeConsecutiveDates(3);
      const reports = [
        makeReport({ date: dates[0], pain: 7 }),
        makeReport({ date: dates[1], pain: 5 }),
        makeReport({ date: dates[2], pain: 3 }),
      ];
      const alerts = checkAlerts(reports);
      expect(alerts.some(a => a.id === 'ascending_pain')).toBe(true);
    });

    it('does NOT trigger ascending pain for flat pain', () => {
      const dates = makeConsecutiveDates(3);
      const reports = dates.map(date => makeReport({ date, pain: 5 }));
      expect(checkAlerts(reports).some(a => a.id === 'ascending_pain')).toBe(false);
    });

    it('does NOT trigger ascending pain with less than 3 reports', () => {
      const dates = makeConsecutiveDates(2);
      const reports = dates.map((date, i) => makeReport({ date, pain: 5 + i }));
      expect(checkAlerts(reports).some(a => a.id === 'ascending_pain')).toBe(false);
    });
  });

  // === Urinary Alerts ===
  describe('urinary alerts', () => {
    it('triggers urinary_retention when latest is 尿不出來', () => {
      const reports = [makeReport({ date: '2026-03-18', urinary: '尿不出來' })];
      const alerts = checkAlerts(reports);
      expect(alerts.some(a => a.id === 'urinary_retention')).toBe(true);
      expect(alerts.find(a => a.id === 'urinary_retention').type).toBe('danger');
    });

    it('triggers urinary_difficulty for 2+ consecutive days of 困難', () => {
      const dates = makeConsecutiveDates(2);
      const reports = dates.map(date => makeReport({ date, urinary: '困難' }));
      const alerts = checkAlerts(reports);
      expect(alerts.some(a => a.id === 'urinary_difficulty')).toBe(true);
    });

    it('does NOT trigger urinary_difficulty for single day', () => {
      const reports = [makeReport({ date: '2026-03-18', urinary: '困難' })];
      expect(checkAlerts(reports).some(a => a.id === 'urinary_difficulty')).toBe(false);
    });

    it('counts 尿不出來 toward urinary_difficulty streak', () => {
      const dates = makeConsecutiveDates(2);
      const reports = [
        makeReport({ date: dates[0], urinary: '困難' }),
        makeReport({ date: dates[1], urinary: '尿不出來' }),
      ];
      const alerts = checkAlerts(reports);
      expect(alerts.some(a => a.id === 'urinary_difficulty')).toBe(true);
    });
  });

  // === Continence Alerts ===
  describe('continence alerts', () => {
    it('triggers incontinence when latest is 失禁', () => {
      const reports = [makeReport({ date: '2026-03-18', continence: '失禁' })];
      const alerts = checkAlerts(reports);
      expect(alerts.some(a => a.id === 'incontinence')).toBe(true);
      expect(alerts.find(a => a.id === 'incontinence').type).toBe('danger');
    });

    it('triggers soiling for 2+ consecutive days of 滲便', () => {
      const dates = makeConsecutiveDates(2);
      const reports = dates.map(date => makeReport({ date, continence: '滲便' }));
      const alerts = checkAlerts(reports);
      expect(alerts.some(a => a.id === 'soiling')).toBe(true);
    });

    it('does NOT trigger soiling for single day of 滲便', () => {
      const reports = [makeReport({ date: '2026-03-18', continence: '滲便' })];
      expect(checkAlerts(reports).some(a => a.id === 'soiling')).toBe(false);
    });

    it('counts 失禁 toward soiling streak', () => {
      const dates = makeConsecutiveDates(2);
      const reports = [
        makeReport({ date: dates[0], continence: '滲便' }),
        makeReport({ date: dates[1], continence: '失禁' }),
      ];
      const alerts = checkAlerts(reports);
      expect(alerts.some(a => a.id === 'soiling')).toBe(true);
    });
  });

  // === Report-count vs calendar-day wording ===
  // The engine counts consecutive *reports*, never consecutive dates. That is the
  // right behaviour for this study — the follow-up schedule tapers (daily to POD 7,
  // then every 2 days, then weekly), so non-adjacent reports are the designed norm
  // and requiring adjacency would switch these safety alerts off for most of the
  // 30-day window. What must not happen is the message claiming calendar days it
  // never checked: HSF-001 reported soiling on POD 7 and POD 9 with nothing on
  // POD 8, and the alert read "已連續 2 天出現滲便".
  describe('回報次數 vs 日曆天數的措辭', () => {
    const noDayClaim = /連續\s*\d+\s*天/;

    it('滲便：跳過一天的兩次回報不得宣稱「連續 N 天」', () => {
      const reports = [
        makeReport({ date: '2026-07-31', continence: '滲便' }),
        makeReport({ date: '2026-08-02', continence: '滲便' }),
      ];
      const alert = checkAlerts(reports).find(a => a.id === 'soiling');

      expect(alert).toBeDefined();
      expect(alert.message).not.toMatch(noDayClaim);
      expect(alert.message).toContain('2026-07-31');
      expect(alert.message).toContain('2026-08-02');
    });

    it('高度疼痛：跨越空缺日的三次回報不得宣稱「連續 N 天」', () => {
      const reports = [
        makeReport({ date: '2026-07-28', pain: 9 }),
        makeReport({ date: '2026-07-30', pain: 9 }),
        makeReport({ date: '2026-08-02', pain: 9 }),
      ];
      const alert = checkAlerts(reports).find(a => a.id === 'high_pain');

      expect(alert).toBeDefined();
      expect(alert.message).not.toMatch(noDayClaim);
      expect(alert.message).toContain('2026-07-28');
    });

    it('未排便與排尿困難同樣不得宣稱天數', () => {
      const reports = [
        makeReport({ date: '2026-07-28', bowel: '未排', urinary: '困難' }),
        makeReport({ date: '2026-07-30', bowel: '未排', urinary: '困難' }),
        makeReport({ date: '2026-08-02', bowel: '未排', urinary: '困難' }),
      ];
      const alerts = checkAlerts(reports);

      expect(alerts.find(a => a.id === 'no_bowel').message).not.toMatch(noDayClaim);
      expect(alerts.find(a => a.id === 'urinary_difficulty').message).not.toMatch(noDayClaim);
    });

    it('真正連續的日子仍照常觸發（不得因措辭調整而失效）', () => {
      const dates = makeConsecutiveDates(3);
      const reports = dates.map(date => makeReport({ date, pain: 9 }));

      expect(checkAlerts(reports).some(a => a.id === 'high_pain')).toBe(true);
    });
  });

  // === Multiple Alerts ===
  it('can trigger multiple alerts simultaneously', () => {
    const dates = makeConsecutiveDates(3);
    const reports = dates.map(date =>
      makeReport({ date, pain: 10, bleeding: '血塊', bowel: '未排', fever: true })
    );
    const alerts = checkAlerts(reports);
    expect(alerts.length).toBeGreaterThanOrEqual(4);
    expect(alerts.some(a => a.id === 'high_pain')).toBe(true);
    expect(alerts.some(a => a.id === 'blood_clot')).toBe(true);
    expect(alerts.some(a => a.id === 'no_bowel')).toBe(true);
    expect(alerts.some(a => a.id === 'fever')).toBe(true);
  });
});

describe('getAlertLevel', () => {
  it('returns "danger" when any alert is danger type', () => {
    const alerts = [{ type: 'warning' }, { type: 'danger' }];
    expect(getAlertLevel(alerts)).toBe('danger');
  });

  it('returns "warning" when highest is warning', () => {
    const alerts = [{ type: 'warning' }];
    expect(getAlertLevel(alerts)).toBe('warning');
  });

  it('returns "safe" when no alerts', () => {
    expect(getAlertLevel([])).toBe('safe');
  });
});
