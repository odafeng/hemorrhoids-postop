// Tests for the health-check logic (dependency-injected, no real network/env).
// Run: deno test supabase/functions/health/checks.test.ts
import assert from "node:assert/strict";
import { createHandler, type HealthDeps, runHealthChecks } from "./checks.ts";

type Routes = {
  anthropic?: () => Response;
  openai?: () => Response;
};

function makeFetch(routes: Routes, calls: string[]) {
  return (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url.includes("api.anthropic.com")) {
      if (!routes.anthropic) throw new Error("anthropic route not configured");
      return Promise.resolve(routes.anthropic());
    }
    if (url.includes("api.openai.com")) {
      return Promise.resolve(
        routes.openai ? routes.openai() : new Response("{}", { status: 200 }),
      );
    }
    throw new Error("unexpected fetch url: " + url);
  };
}

function baseDeps(overrides: {
  env?: Record<string, string | undefined>;
  routes?: Routes;
  dbCount?: HealthDeps["dbCount"];
  calls?: string[];
} = {}) {
  const env: Record<string, string | undefined> = {
    CLAUDE_API_KEY: "sk-test",
    OPENAI_API_KEY: "sk-openai",
    SUPABASE_URL: "http://db",
    SUPABASE_SERVICE_ROLE_KEY: "svc",
    VAPID_PUBLIC_KEY: "vapid",
    ...(overrides.env ?? {}),
  };
  const calls = overrides.calls ?? [];
  const routes: Routes = overrides.routes ?? {
    anthropic: () => new Response("{}", { status: 200 }),
    openai: () => new Response("{}", { status: 200 }),
  };
  const deps: HealthDeps = {
    getEnv: (k) => env[k],
    fetch: makeFetch(routes, calls) as unknown as typeof fetch,
    dbCount: overrides.dbCount ?? (() => Promise.resolve({ count: 5, error: null })),
  };
  return { deps, calls };
}

Deno.test("all dependencies up -> healthy", async () => {
  const { deps } = baseDeps();
  const r = await runHealthChecks(deps);
  assert.equal(r.status, "healthy");
  assert.equal(r.checks.anthropic, "ok");
  assert.equal(r.checks.database, "ok");
});

Deno.test("anthropic key present but call fails (credit exhausted) -> degraded", async () => {
  const { deps } = baseDeps({
    routes: {
      anthropic: () =>
        new Response(JSON.stringify({ error: { message: "credit balance too low" } }), {
          status: 400,
        }),
      openai: () => new Response("{}", { status: 200 }),
    },
  });
  const r = await runHealthChecks(deps);
  assert.equal(r.status, "degraded");
  assert.ok(r.checks.anthropic.startsWith("error"));
});

Deno.test("anthropic error surfaces the API message (for actionable alerts)", async () => {
  const { deps } = baseDeps({
    routes: {
      anthropic: () =>
        new Response(JSON.stringify({ error: { message: "credit balance is too low" } }), {
          status: 400,
        }),
      openai: () => new Response("{}", { status: 200 }),
    },
  });
  const r = await runHealthChecks(deps);
  assert.ok(r.checks.anthropic.includes("credit balance is too low"));
});

Deno.test("database unreachable -> degraded", async () => {
  const { deps } = baseDeps({
    dbCount: () => Promise.resolve({ count: null, error: new Error("connection refused") }),
  });
  const r = await runHealthChecks(deps);
  assert.equal(r.status, "degraded");
  assert.ok(r.checks.database.startsWith("error"));
});

Deno.test("openai down is non-fatal -> still healthy", async () => {
  const { deps } = baseDeps({
    routes: {
      anthropic: () => new Response("{}", { status: 200 }),
      openai: () => new Response("", { status: 500 }),
    },
  });
  const r = await runHealthChecks(deps);
  assert.equal(r.status, "healthy");
  assert.ok(r.checks.openai.startsWith("error"));
});

Deno.test("missing CLAUDE_API_KEY -> degraded without calling anthropic", async () => {
  const calls: string[] = [];
  const { deps } = baseDeps({ env: { CLAUDE_API_KEY: undefined }, calls });
  const r = await runHealthChecks(deps);
  assert.equal(r.status, "degraded");
  assert.equal(r.checks.anthropic, "missing");
  assert.ok(!calls.some((u) => u.includes("api.anthropic.com")));
});

Deno.test("handler rejects wrong token without running any checks", async () => {
  const calls: string[] = [];
  const { deps } = baseDeps({ env: { HEALTH_TOKEN: "secret" }, calls });
  const res = await createHandler(deps)(new Request("https://x/health?token=wrong"));
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

Deno.test("handler accepts correct token, returns 503 when degraded", async () => {
  const { deps } = baseDeps({
    env: { HEALTH_TOKEN: "secret" },
    routes: {
      anthropic: () => new Response("", { status: 401 }),
      openai: () => new Response("{}", { status: 200 }),
    },
  });
  const res = await createHandler(deps)(new Request("https://x/health?token=secret"));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).status, "degraded");
});

Deno.test("handler returns 200 healthy body when all up", async () => {
  const { deps } = baseDeps({ env: { HEALTH_TOKEN: "secret" } });
  const res = await createHandler(deps)(new Request("https://x/health?token=secret"));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "healthy");
});

Deno.test("handler runs ungated when no HEALTH_TOKEN configured", async () => {
  const { deps } = baseDeps();
  const res = await createHandler(deps)(new Request("https://x/health"));
  assert.equal(res.status, 200);
});
