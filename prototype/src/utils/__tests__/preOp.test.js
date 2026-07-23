// A patient can be enrolled BEFORE their operation. getPODFromDate clamps to 0,
// which is correct for a POD label but erases the pre-operative case: the
// dashboard announced 手術當日 to someone operating tomorrow, and a report filed
// that evening was stored as pod = 0 with a pre-operative report_date. Reports
// upsert on (study_id, report_date), so the genuine POD 0 the next day became a
// SECOND row — two POD 0 observations, one taken before surgery, with nothing in
// the data to separate them later.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../supabaseClient', () => ({ default: null, supabase: null }));

const { getDaysFromSurgery, getPODFromDate } = await import('../supabaseService');

const isoOffsetFromToday = (days) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
};

describe('getDaysFromSurgery — signed offset', () => {
  it('is negative before surgery, which is the whole point', () => {
    expect(getDaysFromSurgery(isoOffsetFromToday(1))).toBe(-1);
    expect(getDaysFromSurgery(isoOffsetFromToday(7))).toBe(-7);
  });

  it('is 0 on the day of surgery', () => {
    expect(getDaysFromSurgery(isoOffsetFromToday(0))).toBe(0);
  });

  it('counts up after surgery', () => {
    expect(getDaysFromSurgery(isoOffsetFromToday(-3))).toBe(3);
    expect(getDaysFromSurgery(isoOffsetFromToday(-30))).toBe(30);
  });

  it('returns 0 rather than NaN when the date is missing', () => {
    expect(getDaysFromSurgery(null)).toBe(0);
    expect(getDaysFromSurgery(undefined)).toBe(0);
  });

  it('disagrees with getPODFromDate exactly where the bug lived', () => {
    const tomorrow = isoOffsetFromToday(1);
    // The clamp is why a pre-op patient saw "POD 0 · 手術當日".
    expect(getPODFromDate(tomorrow)).toBe(0);
    expect(getDaysFromSurgery(tomorrow)).toBe(-1);
  });
});

describe('invite token format', () => {
  let generateInviteToken;

  beforeEach(async () => {
    vi.resetModules();
    // Exercise the real generator: it is module-private, so reach it through
    // createStudyInvite's dependency on crypto.getRandomValues.
    const realCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      ...realCrypto,
      getRandomValues: (arr) => realCrypto.getRandomValues(arr),
    });
    const mod = await import('../supabaseService');
    generateInviteToken = mod.__test_generateInviteToken;
  });

  afterEach(() => vi.unstubAllGlobals());

  it('is 6 uppercase letters — short enough to dictate at the bedside', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateInviteToken()).toMatch(/^[A-Z]{6}$/);
    }
  });

  it('never emits O, I or L, which are misread off paper', () => {
    const seen = new Set();
    for (let i = 0; i < 400; i += 1) {
      for (const ch of generateInviteToken()) seen.add(ch);
    }
    expect([...seen].filter((c) => 'OIL'.includes(c))).toEqual([]);
  });

  it('survives normalizeInviteCode unchanged, or stored and typed forms diverge', async () => {
    const { normalizeInviteCode } = await import('../inviteCode');
    for (let i = 0; i < 50; i += 1) {
      const t = generateInviteToken();
      expect(normalizeInviteCode(t)).toBe(t);
    }
  });
});
