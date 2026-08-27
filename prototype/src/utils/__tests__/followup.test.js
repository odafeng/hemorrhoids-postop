import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CLOSE_WARNING_DAYS,
  closeOutState,
  FOLLOWUP_DAYS,
  followUpEndsOn,
  STUDY_STATUS,
} from '../followup.js';

const SURGERY = '2026-07-24'; // POD 30 falls on 2026-08-23

describe('followUpEndsOn', () => {
  it('is the surgery date plus the window', () => {
    expect(followUpEndsOn(SURGERY)).toBe('2026-08-23');
    expect(followUpEndsOn('2026-08-05')).toBe('2026-09-04');
  });

  it('tolerates a timestamp and rejects junk instead of returning a bad date', () => {
    expect(followUpEndsOn('2026-07-24T09:00:00+08:00')).toBe('2026-08-23');
    expect(followUpEndsOn(null)).toBeNull();
    expect(followUpEndsOn('not-a-date')).toBeNull();
  });
});

describe('closeOutState', () => {
  const at = (pod, status = STUDY_STATUS.ACTIVE) => closeOutState(status, pod, SURGERY);

  it('counts down over the last week and not before', () => {
    expect(at(22).kind).toBe('active');
    expect(at(23)).toMatchObject({ kind: 'closing', daysLeft: 7 });
    expect(at(29)).toMatchObject({ kind: 'closing', daysLeft: 1 });
  });

  it('marks the endpoint day itself as due, not as closing', () => {
    expect(at(30)).toMatchObject({ kind: 'due', daysLeft: 0 });
  });

  it('flags a row still active past the endpoint', () => {
    // HSF-001 sat here for five days with nothing surfacing it.
    expect(at(35)).toMatchObject({ kind: 'overdue', daysLeft: -5 });
  });

  it('reports the stored status ahead of any POD arithmetic', () => {
    expect(at(35, STUDY_STATUS.COMPLETED).kind).toBe('closed');
    expect(at(35, STUDY_STATUS.WITHDRAWN).kind).toBe('withdrawn');
  });

  it('does not guess when POD is unknown', () => {
    expect(closeOutState(STUDY_STATUS.ACTIVE, null, SURGERY)).toMatchObject({
      kind: 'active',
      daysLeft: null,
    });
  });

  it('carries the endpoint date for display', () => {
    expect(at(23).endsOn).toBe('2026-08-23');
  });
});

describe('mirror of supabase/functions/_shared/followup.ts', () => {
  // The duplication is only tolerable because this reads the real file. A comment
  // saying "keep these in sync" would not have caught anything.
  // vitest runs from prototype/. If that ever stops being true, fail loudly here
  // rather than let the mirror check silently pass on an empty read.
  const path = resolve(globalThis.process.cwd(), 'supabase/functions/_shared/followup.ts');
  it('can find the file it is pinned against', () => {
    expect(existsSync(path)).toBe(true);
  });
  const source = existsSync(path) ? readFileSync(path, 'utf8') : '';

  it('agrees on the window length', () => {
    expect(source).toMatch(new RegExp(`FOLLOWUP_DAYS\\s*=\\s*${FOLLOWUP_DAYS}\\b`));
  });

  it('agrees on every status value', () => {
    for (const value of Object.values(STUDY_STATUS)) {
      expect(source).toContain(`"${value}"`);
    }
  });

  it('keeps CLOSE_WARNING_DAYS inside the window', () => {
    expect(CLOSE_WARNING_DAYS).toBeGreaterThan(0);
    expect(CLOSE_WARNING_DAYS).toBeLessThan(FOLLOWUP_DAYS);
  });
});
