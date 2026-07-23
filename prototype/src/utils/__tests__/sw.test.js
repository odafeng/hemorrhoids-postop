// Service worker activate-handler tests.
//
// index.html no longer reloads the page on controllerchange (a deploy during
// clinic hours would wipe a half-typed symptom report), so the SW_UPDATED
// message is now the ONLY trigger for <UpdateBanner>. Two things must hold:
//   - a first install must NOT announce an update (nothing was updated)
//   - an upgrade MUST announce one, or the patient silently runs stale code
//
// public/sw.js is a classic worker script, not a module, so we execute it in a
// sandbox with a hand-rolled ServiceWorkerGlobalScope.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SW_SOURCE = readFileSync(resolve(HERE, '../../../public/sw.js'), 'utf8');

function makeCachesMock(initialKeys) {
  const store = new Set(initialKeys);
  return {
    store,
    deleted: [],
    keys: async function () { return [...store]; },
    open: async function () { return { addAll: async () => {}, put: async () => {} }; },
    delete: async function (key) {
      this.deleted.push(key);
      return store.delete(key);
    },
    match: async () => undefined,
  };
}

/**
 * Load public/sw.js against a fake global scope and fire one lifecycle event.
 * Returns everything the handler touched.
 */
async function runActivate({ existingCacheKeys }) {
  const listeners = {};
  const posted = [];
  const matchAllCalls = [];
  const cachesMock = makeCachesMock(existingCacheKeys);

  const client = { postMessage: (msg) => posted.push(msg) };

  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    clients: {
      claim: () => {},
      matchAll: async (opts) => { matchAllCalls.push(opts); return [client]; },
      openWindow: async () => {},
    },
    registration: { showNotification: async () => {} },
    location: { origin: 'https://example.test' },
  };

  // SW_SOURCE is our own first-party file read off disk, never user input.
  new Function('self', 'caches', 'console', SW_SOURCE)(self, cachesMock, {
    log: () => {}, warn: () => {}, error: () => {},
  });

  const pending = [];
  await listeners.activate({ waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);

  return { posted, cachesMock, matchAllCalls };
}

describe('service worker — activate', () => {
  let currentCacheName;

  beforeEach(() => {
    const m = SW_SOURCE.match(/const CACHE_NAME = '([^']+)'/);
    currentCacheName = m?.[1];
    expect(currentCacheName, 'sw.js must declare CACHE_NAME').toBeTruthy();
  });

  it('does not announce an update on a first install', async () => {
    // Only the cache this very worker just created in `install` exists.
    const { posted } = await runActivate({ existingCacheKeys: [currentCacheName] });
    expect(posted).toEqual([]);
  });

  it('announces an update when a previous version cache is present', async () => {
    const { posted } = await runActivate({
      existingCacheKeys: [currentCacheName, 'postop-tracker-v1'],
    });
    expect(posted).toEqual([{ type: 'SW_UPDATED', version: currentCacheName }]);
  });

  it('deletes stale caches but keeps the current one', async () => {
    const { cachesMock } = await runActivate({
      existingCacheKeys: [currentCacheName, 'postop-tracker-v1', 'postop-tracker-v2'],
    });
    expect(cachesMock.deleted.sort()).toEqual(['postop-tracker-v1', 'postop-tracker-v2']);
    expect(cachesMock.store.has(currentCacheName)).toBe(true);
  });

  it('leaves caches owned by other apps alone', async () => {
    const { cachesMock, posted } = await runActivate({
      existingCacheKeys: [currentCacheName, 'workbox-precache', 'some-other-app-v3'],
    });
    expect(cachesMock.deleted).toEqual([]);
    // Foreign caches must not be mistaken for a previous version of this app.
    expect(posted).toEqual([]);
  });

  it('reaches clients that the worker does not control yet', async () => {
    const { matchAllCalls } = await runActivate({
      existingCacheKeys: [currentCacheName, 'postop-tracker-v1'],
    });
    // clients.claim() races the waitUntil chain; without includeUncontrolled
    // the page that triggered the update can miss the message entirely.
    expect(matchAllCalls[0]).toMatchObject({ includeUncontrolled: true });
  });
});
