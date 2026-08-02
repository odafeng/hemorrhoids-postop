// Tests for the health-check logic (dependency-injected, no real network/env).
// Run: deno test supabase/functions/health/checks.test.ts
import assert from "node:assert/strict";
import { createHandler, type HealthDeps, runHealthChecks } from "./checks.ts";

type Routes = {
  anthropic?: () => Response;
  anthropicModels?: () => Response;
  openai?: () => Response;
};

type Call = { url: string; method: string; key: string | undefined };

function makeFetch(routes: Routes, calls: Call[]) {
  return (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method ?? "GET",
      key: headers.get("x-api-key") ?? headers.get("Authorization") ?? undefined,
    });
    if (url.includes("api.anthropic.com")) {
      // The paid generation canary (POST /v1/messages) and the free key-validity
      // probe (GET /v1/models) share a host but are different checks.
      if (url.includes("/v1/models")) {
        return Promise.resolve(
          routes.anthropicModels ? routes.anthropicModels() : new Response("{}", { status: 200 }),
        );
      }
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
  calls?: Call[];
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
  const calls: Call[] = [];
  const { deps } = baseDeps({ env: { CLAUDE_API_KEY: undefined }, calls });
  const r = await runHealthChecks(deps);
  assert.equal(r.status, "degraded");
  assert.equal(r.checks.anthropic, "missing");
  assert.ok(!calls.some((c) => c.url.includes("api.anthropic.com")));
});

// --- Split billing keys -------------------------------------------------
// The canary bills on its own key so the Anthropic console separates monitoring
// spend from real patient usage. That costs one thing: a revoked *chat* key no
// longer shows up in the canary, so a free GET /v1/models probe covers it.

Deno.test("canary bills HEALTH_CLAUDE_API_KEY while the chat key is probed for free", async () => {
  const calls: Call[] = [];
  const { deps } = baseDeps({
    env: { CLAUDE_API_KEY: "sk-chat", HEALTH_CLAUDE_API_KEY: "sk-monitor" },
    calls,
  });
  const r = await runHealthChecks(deps);
  assert.equal(r.status, "healthy");

  const canary = calls.find((c) => c.url.includes("/v1/messages"));
  assert.equal(canary?.key, "sk-monitor", "paid generation must bill the monitoring key");

  const keyProbe = calls.find((c) => c.url.includes("api.anthropic.com") && c.url.includes("/v1/models"));
  assert.equal(keyProbe?.method, "GET", "key probe must not be a billable generation");
  assert.equal(keyProbe?.key, "sk-chat", "key probe must validate the key ai-chat actually uses");
});

Deno.test("canary falls back to CLAUDE_API_KEY when no monitoring key is set", async () => {
  const calls: Call[] = [];
  const { deps } = baseDeps({ env: { CLAUDE_API_KEY: "sk-chat" }, calls });
  const r = await runHealthChecks(deps);
  assert.equal(r.status, "healthy");
  assert.equal(calls.find((c) => c.url.includes("/v1/messages"))?.key, "sk-chat");
});

Deno.test("revoked chat key -> degraded even when the monitoring key is fine", async () => {
  const { deps } = baseDeps({
    env: { CLAUDE_API_KEY: "sk-revoked", HEALTH_CLAUDE_API_KEY: "sk-monitor" },
    routes: {
      anthropic: () => new Response("{}", { status: 200 }),
      anthropicModels: () =>
        new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 }),
      openai: () => new Response("{}", { status: 200 }),
    },
  });
  const r = await runHealthChecks(deps);
  assert.equal(r.checks.anthropic, "ok");
  assert.equal(r.status, "degraded", "ai-chat is broken even though the canary passed");
  assert.ok(r.checks.chat_key.startsWith("error"));
});

Deno.test("handler rejects wrong token without running any checks", async () => {
  const calls: Call[] = [];
  const { deps } = baseDeps({ env: { HEALTH_TOKEN: "secret" }, calls });
  const res = await createHandler(deps)(new Request("https://x/health?token=wrong"));
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

Deno.test("handler accepts token via x-health-token header (no secret in URL)", async () => {
  const { deps } = baseDeps({ env: { HEALTH_TOKEN: "secret" } });
  const res = await createHandler(deps)(
    new Request("https://x/health", { headers: { "x-health-token": "secret" } }),
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "healthy");
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
