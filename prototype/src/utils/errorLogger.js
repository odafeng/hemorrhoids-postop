// Production-grade error logging with Sentry + Supabase dual-write

import * as Sentry from '@sentry/react';

const LOG_TABLE = 'client_error_logs';
let _sentryInitialized = false;

/**
 * Initialize Sentry (call once at app startup)
 */
export function initSentry() {
  if (_sentryInitialized) return;
  _sentryInitialized = true;

  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    console.info('[Sentry] No DSN configured, skipping initialization');
    return;
  }

  try {
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.2,
      beforeSend(event) {
        // Skip dev mode + demo — Sentry project only stores production issues
        if (import.meta.env.DEV) return null;
        if (window.location.href.includes('demo')) return null;
        return event;
      },
    });
  } catch (e) {
    _sentryInitialized = false;
    console.warn('[Sentry] init failed (non-fatal):', e?.message || e);
  }
}

export const Severity = {
  FATAL: 'fatal',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
};

// -------- Rate limiting + re-entrancy guard --------
// Prevents runaway logging loops that crashed the browser tab.
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 20;          // at most 20 logs per 10s across the whole app
let _recentCount = 0;
let _windowStart = 0;
let _inLogError = false;
let _warnedSuppressed = false;

function shouldLog() {
  const now = Date.now();
  if (now - _windowStart > RATE_WINDOW_MS) {
    _windowStart = now;
    _recentCount = 0;
    _warnedSuppressed = false;
  }
  if (_recentCount >= RATE_MAX) {
    if (!_warnedSuppressed) {
      _warnedSuppressed = true;
      console.warn('[errorLogger] suppressing further errors in this window');
    }
    return false;
  }
  _recentCount++;
  return true;
}

/**
 * Coerce anything thrown into an Error that still says what went wrong.
 *
 * Supabase read failures arrive as a plain object literal — `{message, details,
 * hint, code}`, not an Error (see @supabase/postgrest-js PostgrestBuilder.ts).
 * `String(obj)` on those yields "[object Object]", which is what production
 * reported for a month: the cause was destroyed at the point of logging.
 */
function toError(value) {
  if (value instanceof Error) return value;
  if (value && typeof value === 'object') {
    const parts = [
      value.message,
      value.code ? `code=${value.code}` : null,
      value.details,
      value.hint,
    ].filter(Boolean);
    let text;
    if (parts.length) {
      text = parts.join(' | ');
    } else {
      try { text = JSON.stringify(value); } catch { text = '(unserializable object)'; }
    }
    const err = new Error(text);
    if (value.name) err.name = value.name;
    return err;
  }
  return new Error(String(value));
}

/**
 * Log a structured error — Sentry + Supabase + console.
 * Never throws, never rejects, never re-enters itself.
 *
 * `context.metadata` goes to both Sentry and Supabase; `context.privateMetadata`
 * goes to Supabase only, for anything that should not leave the institution.
 */
export async function logError(error, context = {}) {
  if (_inLogError) return;      // re-entrancy guard
  if (!shouldLog()) return;     // rate limit
  _inLogError = true;
  try {
    const severity = context.severity || Severity.ERROR;
    let errorObj;
    try {
      errorObj = toError(error);
    } catch {
      errorObj = new Error('unserializable error');
    }

    const consoleFn = severity === Severity.FATAL || severity === Severity.ERROR
      ? console.error : severity === Severity.WARNING ? console.warn : console.info;
    try {
      consoleFn(`[${severity.toUpperCase()}] ${context.type || 'error'}:`, errorObj.message || errorObj);
    } catch { /* console best-effort */ }

    if (_sentryInitialized) {
      try {
        Sentry.withScope((scope) => {
          scope.setLevel(severity);
          scope.setTag('error_type', context.type || 'unknown');
          if (context.component) scope.setTag('component', context.component);
          if (context.metadata) scope.setContext('metadata', context.metadata);
          Sentry.captureException(errorObj);
        });
      } catch { /* Sentry best-effort */ }
    }

    try {
      const { default: supabase } = await import('./supabaseClient');
      if (supabase) {
        await supabase.from(LOG_TABLE).insert({
          error_message: errorObj.message || '(no message)',
          error_stack: errorObj.stack || null,
          context: JSON.stringify({
            type: context.type || 'unknown',
            severity,
            component: context.component || null,
            metadata: context.metadata || null,
            privateMetadata: context.privateMetadata || null,
          }),
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
          url: typeof window !== 'undefined' ? window.location.href : 'unknown',
          timestamp: new Date().toISOString(),
        });
      }
    } catch { /* DB log best-effort */ }
  } catch { /* swallow — logError must NEVER throw */
    // swallow everything — logError must NEVER throw or reject
  } finally {
    _inLogError = false;
  }
}

/**
 * Install global error handlers (idempotent)
 */
let _installed = false;
export function installGlobalErrorHandlers() {
  if (_installed) return;
  _installed = true;

  window.addEventListener('error', (event) => {
    // Fire-and-forget; logError handles its own errors internally
    logError(event.error || event.message, {
      type: 'unhandled_error',
      severity: Severity.FATAL,
      component: 'global',
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    logError(event.reason, {
      type: 'unhandled_rejection',
      severity: Severity.ERROR,
      component: 'global',
    });
  });
}
