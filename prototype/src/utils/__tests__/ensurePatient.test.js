// ensurePatient must THROW when the patient-onboard Edge Function rejects.
//
// It used to log and return null, which read as "nothing to do" to the caller.
// Combined with the caller dropping the one-shot invite token up-front, a
// single transient 4xx/5xx left the patient with an auth account, no patients
// row, no app_metadata claims, and no way to retry — recoverable only by hand
// in the Supabase dashboard.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'jwt' } } })) },
  // getPatient() → .from().select().eq().single(); "no rows" means the patient
  // record does not exist yet, which is the path that calls patient-onboard.
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(async () => ({ data: null, error: { code: 'PGRST116', message: 'no rows' } })),
      })),
    })),
  })),
}));

vi.mock('../supabaseClient', () => ({ default: supabaseMock, supabase: supabaseMock }));

const respond = (status, jsonImpl) => vi.fn(async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: jsonImpl,
}));

describe('ensurePatient — failure propagation', () => {
  let ensurePatient;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    import.meta.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
    import.meta.env.VITE_SUPABASE_ANON_KEY = 'anon-key';
    ({ ensurePatient } = await import('../supabaseService'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('throws with the server message and status on 409 duplicate study_id', async () => {
    vi.stubGlobal('fetch', respond(409, async () => ({
      error: '研究編號 HSF-001 已被其他帳號使用，請聯絡研究團隊確認編號。',
    })));

    await expect(ensurePatient('HSF-001', 'INVITE-XYZ')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('已被其他帳號使用'),
    });
  });

  it('throws on 403 invalid invite token', async () => {
    vi.stubGlobal('fetch', respond(403, async () => ({ error: 'Invalid or expired invite token' })));

    await expect(ensurePatient('HSF-001', 'BAD-TOKEN')).rejects.toMatchObject({ status: 403 });
  });

  it('throws on a non-JSON gateway failure instead of reporting success', async () => {
    vi.stubGlobal('fetch', respond(502, async () => { throw new SyntaxError('Unexpected token <'); }));

    await expect(ensurePatient('HSF-001', 'INVITE-XYZ')).rejects.toThrow('HTTP 502');
  });

  it('throws when a captive portal answers 200 with a non-JSON login page', async () => {
    // Hospital Wi-Fi / corporate proxies answer every request with 200 + HTML.
    // The Edge Function was never reached, so treating this as success would
    // burn the one-shot invite token for a patient record that never existed.
    vi.stubGlobal('fetch', respond(200, async () => { throw new SyntaxError('Unexpected token <'); }));

    await expect(ensurePatient('HSF-001', 'INVITE-XYZ')).rejects.toThrow(/HTTP 200/);
  });

  it('throws when a 200 response carries no patient payload', async () => {
    vi.stubGlobal('fetch', respond(200, async () => ({})));

    await expect(ensurePatient('HSF-001', 'INVITE-XYZ')).rejects.toThrow(/伺服器回應異常/);
  });

  it('returns the patient row on success', async () => {
    vi.stubGlobal('fetch', respond(201, async () => ({
      patient: { study_id: 'HSF-001', surgery_date: '2026-07-10' },
    })));

    await expect(ensurePatient('HSF-001', 'INVITE-XYZ')).resolves.toMatchObject({
      study_id: 'HSF-001',
    });
  });

  it('forwards the invite token to patient-onboard', async () => {
    const fetchMock = respond(201, async () => ({ patient: { study_id: 'HSF-001' } }));
    vi.stubGlobal('fetch', fetchMock);

    await ensurePatient('HSF-001', 'INVITE-XYZ');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/functions/v1/patient-onboard');
    expect(JSON.parse(init.body)).toEqual({ invite_token: 'INVITE-XYZ' });
  });
});
