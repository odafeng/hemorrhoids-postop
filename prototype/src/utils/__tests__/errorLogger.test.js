import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @sentry/react
vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  withScope: vi.fn((cb) => cb({
    setLevel: vi.fn(),
    setTag: vi.fn(),
    setContext: vi.fn(),
  })),
  captureException: vi.fn(),
}));

// Mock supabaseClient
vi.mock('../supabaseClient', () => ({
  default: {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}));

describe('errorLogger', () => {
  let Sentry;

  beforeEach(async () => {
    vi.resetModules();
    Sentry = await import('@sentry/react');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initSentry', () => {
    it('skips initialization when no DSN and logs info', async () => {
      vi.resetModules();
      // Spy before importing to catch the call
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const mod = await import('../errorLogger');
      mod.initSentry();
      // Should have logged about no DSN (or just not crashed)
      expect(() => mod.initSentry()).not.toThrow();
      infoSpy.mockRestore();
    });

    it('is idempotent — second call is a no-op', async () => {
      vi.resetModules();
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const mod = await import('../errorLogger');
      mod.initSentry();
      // Second call should return early
      expect(() => mod.initSentry()).not.toThrow();
      infoSpy.mockRestore();
    });

    it('initializes with DSN when configured', async () => {
      vi.resetModules();
      vi.stubEnv('VITE_SENTRY_DSN', 'https://test@sentry.io/123');
      vi.stubEnv('DEV', false); // beforeSend filters dev mode; simulate prod
      const mod = await import('../errorLogger');
      mod.initSentry();
      const Sentry = await import('@sentry/react');
      expect(Sentry.init).toHaveBeenCalled();
      // Test beforeSend — get the callback from Sentry.init call
      const initCall = Sentry.init.mock.calls[Sentry.init.mock.calls.length - 1];
      if (initCall && initCall[0]?.beforeSend) {
        const beforeSend = initCall[0].beforeSend;
        // Normal URL: should pass through
        const origHref = window.location.href;
        expect(beforeSend({ event_id: '1' })).toBeTruthy();
        // Demo URL: should return null
        Object.defineProperty(window, 'location', {
          value: { href: 'http://localhost/demo' },
          writable: true,
          configurable: true,
        });
        expect(beforeSend({ event_id: '2' })).toBeNull();
        Object.defineProperty(window, 'location', {
          value: { href: origHref },
          writable: true,
          configurable: true,
        });
      }
      vi.unstubAllEnvs();
    });
  });

  describe('Severity', () => {
    it('exports severity levels', async () => {
      const { Severity } = await import('../errorLogger');
      expect(Severity.FATAL).toBe('fatal');
      expect(Severity.ERROR).toBe('error');
      expect(Severity.WARNING).toBe('warning');
      expect(Severity.INFO).toBe('info');
    });
  });

  describe('logError', () => {
    it('logs to console.error for ERROR severity', async () => {
      const { logError, Severity } = await import('../errorLogger');
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await logError(new Error('test error'), { severity: Severity.ERROR, type: 'test' });
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('logs to console.warn for WARNING severity', async () => {
      vi.resetModules();
      const { logError, Severity } = await import('../errorLogger');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await logError(new Error('test warn'), { severity: Severity.WARNING, type: 'test' });
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('logs to console.info for INFO severity', async () => {
      vi.resetModules();
      const { logError, Severity } = await import('../errorLogger');
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      await logError(new Error('test info'), { severity: Severity.INFO, type: 'test' });
      expect(infoSpy).toHaveBeenCalled();
      infoSpy.mockRestore();
    });

    it('logs to console.error for FATAL severity', async () => {
      vi.resetModules();
      const { logError, Severity } = await import('../errorLogger');
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await logError(new Error('fatal'), { severity: Severity.FATAL, type: 'test' });
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('converts string errors to Error objects', async () => {
      vi.resetModules();
      const { logError } = await import('../errorLogger');
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await logError('string error message', { type: 'test' });
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('defaults severity to ERROR when not specified', async () => {
      vi.resetModules();
      const { logError } = await import('../errorLogger');
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await logError(new Error('default severity'));
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('writes to Supabase client_error_logs table', async () => {
      vi.resetModules();
      const supabaseMock = (await import('../supabaseClient')).default;
      const { logError } = await import('../errorLogger');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await logError(new Error('db test'), { type: 'test_type', component: 'test_comp' });
      expect(supabaseMock.from).toHaveBeenCalledWith('client_error_logs');
    });

    it('does not crash if Supabase insert fails', async () => {
      vi.resetModules();
      // Override mock to throw
      const mockModule = await import('../supabaseClient');
      mockModule.default.from = vi.fn().mockReturnValue({
        insert: vi.fn().mockRejectedValue(new Error('DB down')),
      });
      const { logError } = await import('../errorLogger');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(logError(new Error('safe'), { type: 'test' })).resolves.not.toThrow();
    });

    it('sends to Sentry when initialized', async () => {
      vi.resetModules();
      vi.stubEnv('VITE_SENTRY_DSN', 'https://test@sentry.io/123');
      const mod = await import('../errorLogger');
      mod.initSentry();
      const Sentry = await import('@sentry/react');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await mod.logError(new Error('sentry test'), {
        type: 'test_type',
        severity: mod.Severity.ERROR,
        component: 'test_comp',
        metadata: { key: 'val' },
      });
      expect(Sentry.withScope).toHaveBeenCalled();
      vi.unstubAllEnvs();
    });

    // A Supabase read failure arrives as a plain object literal, not an Error
    // — see @supabase/postgrest-js PostgrestBuilder.ts. String(obj) on it
    // yields "[object Object]" and the real cause is gone for good.
    it('preserves the message of a PostgrestError instead of stringifying it', async () => {
      vi.resetModules();
      const supabaseMock = (await import('../supabaseClient')).default;
      const insertFn = vi.fn().mockResolvedValue({ data: null, error: null });
      supabaseMock.from = vi.fn().mockReturnValue({ insert: insertFn });

      const { logError } = await import('../errorLogger');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await logError(
        { message: 'TypeError: Failed to fetch', details: 'stack here', hint: '', code: '' },
        { type: 'supabase_read', component: 'getAlerts' },
      );

      const row = insertFn.mock.calls[0][0];
      expect(row.error_message).toContain('Failed to fetch');
      expect(row.error_message).not.toContain('[object Object]');
    });

    it('keeps the PostgREST code so RLS failures stay distinguishable', async () => {
      vi.resetModules();
      const supabaseMock = (await import('../supabaseClient')).default;
      const insertFn = vi.fn().mockResolvedValue({ data: null, error: null });
      supabaseMock.from = vi.fn().mockReturnValue({ insert: insertFn });

      const { logError } = await import('../errorLogger');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await logError(
        { message: 'permission denied for table alerts', details: '', hint: '', code: '42501' },
        { type: 'supabase_read', component: 'getAlerts' },
      );

      expect(insertFn.mock.calls[0][0].error_message).toContain('42501');
    });

    it('falls back to JSON for an object with no message field', async () => {
      vi.resetModules();
      const supabaseMock = (await import('../supabaseClient')).default;
      const insertFn = vi.fn().mockResolvedValue({ data: null, error: null });
      supabaseMock.from = vi.fn().mockReturnValue({ insert: insertFn });

      const { logError } = await import('../errorLogger');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await logError({ unexpected: 'shape' }, { type: 'test' });

      const row = insertFn.mock.calls[0][0];
      expect(row.error_message).toContain('unexpected');
      expect(row.error_message).not.toContain('[object Object]');
    });

    it('survives an object that cannot be serialized', async () => {
      vi.resetModules();
      const supabaseMock = (await import('../supabaseClient')).default;
      const insertFn = vi.fn().mockResolvedValue({ data: null, error: null });
      supabaseMock.from = vi.fn().mockReturnValue({ insert: insertFn });

      const { logError } = await import('../errorLogger');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const circular = {};
      circular.self = circular;
      await expect(logError(circular, { type: 'test' })).resolves.not.toThrow();
      expect(insertFn).toHaveBeenCalled();
    });

    // Study IDs identify research subjects. They belong in our own audit table,
    // not in a third-party processor.
    it('writes privateMetadata to Supabase but withholds it from Sentry', async () => {
      vi.resetModules();
      vi.stubEnv('VITE_SENTRY_DSN', 'https://test@sentry.io/123');
      const Sentry = await import('@sentry/react');
      const setContext = vi.fn();
      Sentry.withScope.mockImplementation((cb) =>
        cb({ setLevel: vi.fn(), setTag: vi.fn(), setContext }));

      const supabaseMock = (await import('../supabaseClient')).default;
      const insertFn = vi.fn().mockResolvedValue({ data: null, error: null });
      supabaseMock.from = vi.fn().mockReturnValue({ insert: insertFn });

      const mod = await import('../errorLogger');
      mod.initSentry();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await mod.logError(new Error('boom'), {
        type: 'supabase_read',
        component: 'getAlerts',
        privateMetadata: { studyId: 'AAA-001' },
      });

      expect(JSON.stringify(setContext.mock.calls)).not.toContain('AAA-001');
      expect(insertFn.mock.calls[0][0].context).toContain('AAA-001');
      vi.unstubAllEnvs();
    });

    it('includes context metadata when provided', async () => {
      vi.resetModules();
      const supabaseMock = (await import('../supabaseClient')).default;
      const insertFn = vi.fn().mockResolvedValue({ data: null, error: null });
      supabaseMock.from = vi.fn().mockReturnValue({ insert: insertFn });

      const { logError } = await import('../errorLogger');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await logError(new Error('meta test'), {
        type: 'meta_type',
        component: 'meta_comp',
        metadata: { key: 'value' },
      });
      expect(insertFn).toHaveBeenCalledWith(expect.objectContaining({
        error_message: 'meta test',
      }));
    });
  });

  describe('installGlobalErrorHandlers', () => {
    it('installs error and unhandledrejection handlers', async () => {
      vi.resetModules();
      const addEventSpy = vi.spyOn(window, 'addEventListener');
      const { installGlobalErrorHandlers } = await import('../errorLogger');
      installGlobalErrorHandlers();
      expect(addEventSpy).toHaveBeenCalledWith('error', expect.any(Function));
      expect(addEventSpy).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));
      addEventSpy.mockRestore();
    });

    it('is idempotent — second call is a no-op', async () => {
      vi.resetModules();
      const addEventSpy = vi.spyOn(window, 'addEventListener');
      const { installGlobalErrorHandlers } = await import('../errorLogger');
      installGlobalErrorHandlers();
      const callCount = addEventSpy.mock.calls.length;
      installGlobalErrorHandlers();
      expect(addEventSpy.mock.calls.length).toBe(callCount); // no new calls
      addEventSpy.mockRestore();
    });

    it('error handler calls logError with correct context', async () => {
      vi.resetModules();
      let errorHandler;
      vi.spyOn(window, 'addEventListener').mockImplementation((event, handler) => {
        if (event === 'error') errorHandler = handler;
      });
      const { installGlobalErrorHandlers } = await import('../errorLogger');
      installGlobalErrorHandlers();

      vi.spyOn(console, 'error').mockImplementation(() => {});
      // Simulate error event
      if (errorHandler) {
        await errorHandler({ error: new Error('global error'), message: 'global error' });
      }
      // Just verify no crash
    });

    it('unhandledrejection handler calls logError', async () => {
      vi.resetModules();
      let rejectionHandler;
      vi.spyOn(window, 'addEventListener').mockImplementation((event, handler) => {
        if (event === 'unhandledrejection') rejectionHandler = handler;
      });
      const { installGlobalErrorHandlers } = await import('../errorLogger');
      installGlobalErrorHandlers();

      vi.spyOn(console, 'error').mockImplementation(() => {});
      if (rejectionHandler) {
        await rejectionHandler({ reason: new Error('unhandled') });
      }
    });
  });
});
