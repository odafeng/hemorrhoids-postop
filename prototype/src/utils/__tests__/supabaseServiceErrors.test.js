// Read failures in supabaseService hand their PostgrestError to logError.
// logError reads context.type / context.component / context.metadata; passing
// anything else silently drops it — production Sentry issues arrived tagged
// error_type=unknown with no component and no study ID.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../errorLogger', () => ({
  logError: vi.fn(),
  Severity: { FATAL: 'fatal', ERROR: 'error', WARNING: 'warning', INFO: 'info' },
}));

const READ_FAILURE = {
  message: 'TypeError: Failed to fetch',
  details: '',
  hint: '',
  code: '',
};

// Minimal PostgREST builder stub: every chained filter returns itself and the
// whole thing resolves to an error, like a failed read.
function failingQuery() {
  const q = {};
  for (const m of ['select', 'eq', 'order', 'limit']) q[m] = vi.fn(() => q);
  q.then = (resolve) => resolve({ data: null, error: READ_FAILURE });
  return q;
}

vi.mock('../supabaseClient', () => ({
  default: { from: vi.fn(() => failingQuery()) },
}));

describe('supabaseService read-failure reporting', () => {
  let logError;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    ({ logError } = await import('../errorLogger'));
  });

  it('getAlerts tags the failure with a type and component', async () => {
    const sb = await import('../supabaseService');
    await expect(sb.getAlerts('AAA-001')).rejects.toBeDefined();

    const [, context] = logError.mock.calls[0];
    expect(context.type).toBeTruthy();
    expect(context.component).toBe('getAlerts');
  });

  it('getAlerts records which patient hit the failure', async () => {
    const sb = await import('../supabaseService');
    await expect(sb.getAlerts('AAA-001')).rejects.toBeDefined();

    const [, context] = logError.mock.calls[0];
    expect(context.metadata?.studyId).toBe('AAA-001');
  });

  it('getAllAlertsForResearcher tags the failure with a component', async () => {
    const sb = await import('../supabaseService');
    await expect(sb.getAllAlertsForResearcher()).rejects.toBeDefined();

    const [, context] = logError.mock.calls[0];
    expect(context.type).toBeTruthy();
    expect(context.component).toBe('getAllAlertsForResearcher');
  });

  // The CRF is filled from the full backup. A reader that swallows its error
  // into [] makes "this table is empty" and "this read failed" produce the
  // same backup file, and the forms come out silently short.
  it.each([
    'getAllSurgicalRecordsForResearcher',
    'getAllSurveysForResearcher',
    'getAllUtilizationForResearcher',
  ])('%s rejects and tags the failure with its component', async (fnName) => {
    const sb = await import('../supabaseService');
    await expect(sb[fnName]()).rejects.toBeDefined();

    const [, context] = logError.mock.calls[0];
    expect(context.type).toBeTruthy();
    expect(context.component).toBe(fnName);
  });
});
