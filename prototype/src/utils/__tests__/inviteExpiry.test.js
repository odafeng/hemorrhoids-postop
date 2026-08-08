// Invites expire on a fixed date, not N days after they were created.
//
// What these tests actually guard is the end-of-day boundary. patient-onboard
// validates with `expires_at >= now()`, so a constant that decays to a bare
// '2027-12-31' (UTC midnight = 08:00 Taipei) would kill the code on the morning
// of the very day the researcher believes is its last. That exact mistake was
// made once already, on 2026-08-08, while updating the production rows.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Captures the payload handed to PostgREST so we can assert on what would be
// written, without a database.
const captured = vi.hoisted(() => ({ insert: null, update: null, existing: null }));

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(() => ({
    // createStudyInvite first probes for an existing row for this study_id.
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data: captured.existing })),
      })),
    })),
    insert: vi.fn((payload) => {
      captured.insert = payload;
      return {
        select: vi.fn(() => ({ single: vi.fn(async () => ({ data: payload, error: null })) })),
      };
    }),
    update: vi.fn((payload) => {
      captured.update = payload;
      return {
        eq: vi.fn(() => ({
          select: vi.fn(() => ({ single: vi.fn(async () => ({ data: payload, error: null })) })),
        })),
      };
    }),
  })),
}));

vi.mock('../supabaseClient', () => ({ default: supabaseMock, supabase: supabaseMock }));

// 2027-12-31 23:59:59+08:00 expressed as the UTC instant PostgREST receives.
const EXPECTED_UTC = '2027-12-31T15:59:59.000Z';

describe('study invite expiry', () => {
  let createStudyInvite;
  let INVITE_EXPIRY_DATE;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    captured.insert = null;
    captured.update = null;
    captured.existing = null;
    import.meta.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
    import.meta.env.VITE_SUPABASE_ANON_KEY = 'anon-key';
    ({ createStudyInvite, INVITE_EXPIRY_DATE } = await import('../supabaseService'));
  });

  it('stamps a newly created invite with the fixed expiry date', async () => {
    await createStudyInvite('HSF-011');

    expect(captured.insert.expires_at).toBe(EXPECTED_UTC);
  });

  it('applies the same expiry when regenerating an unused invite', async () => {
    captured.existing = { status: 'pending' };

    await createStudyInvite('HSF-011');

    expect(captured.update.expires_at).toBe(EXPECTED_UTC);
  });

  it('expires at end of day Taipei, not start of day', () => {
    const taipei = new Date(INVITE_EXPIRY_DATE)
      .toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' });

    expect(taipei).toBe('2027-12-31 23:59:59');
  });
});
