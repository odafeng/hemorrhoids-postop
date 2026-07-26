// Health-check logic (dependency-injected so it is testable without network/env).
// The HTTP wiring lives in index.ts.

export interface HealthDeps {
  getEnv: (name: string) => string | undefined;
  fetch: typeof fetch;
  dbCount: (table: string) => Promise<{ count: number | null; error: unknown }>;
}

export interface HealthResult {
  status: "healthy" | "degraded";
  checks: Record<string, string>;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Anthropic canary: a real max_tokens:1 generation with the SAME key ai-chat uses.
// Unlike a key-presence check, this catches an exhausted credit balance or a
// revoked key — the failure modes that leave the site up but break the chat.
async function checkAnthropic(deps: HealthDeps): Promise<string> {
  const key = deps.getEnv("CLAUDE_API_KEY");
  if (!key) return "missing";
  try {
    const res = await deps.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    return res.ok ? "ok" : `error: HTTP ${res.status}`;
  } catch (e) {
    return `error: ${msg(e)}`;
  }
}

async function checkDatabase(deps: HealthDeps): Promise<string> {
  try {
    const { error } = await deps.dbCount("rag_documents");
    if (error) throw error;
    return "ok";
  } catch (e) {
    return `error: ${msg(e)}`;
  }
}

// Non-fatal: RAG already degrades gracefully when OpenAI embeddings are absent,
// so a bad OpenAI key is a warning, not an outage. GET /v1/models costs no tokens.
async function checkOpenAI(deps: HealthDeps): Promise<string> {
  const key = deps.getEnv("OPENAI_API_KEY");
  if (!key) return "missing";
  try {
    const res = await deps.fetch("https://api.openai.com/v1/models", {
      headers: { "Authorization": `Bearer ${key}` },
    });
    return res.ok ? "ok" : `error: HTTP ${res.status}`;
  } catch (e) {
    return `error: ${msg(e)}`;
  }
}

export async function runHealthChecks(deps: HealthDeps): Promise<HealthResult> {
  const [anthropic, database, openai] = await Promise.all([
    checkAnthropic(deps),
    checkDatabase(deps),
    checkOpenAI(deps),
  ]);

  const checks: Record<string, string> = {
    anthropic,
    database,
    openai,
    vapid: deps.getEnv("VAPID_PUBLIC_KEY") ? "configured" : "missing",
  };

  // Only Anthropic (generation) and the DB are fatal to the chat feature.
  const status = anthropic === "ok" && database === "ok" ? "healthy" : "degraded";
  return { status, checks };
}

export function createHandler(deps: HealthDeps) {
  return async (req: Request): Promise<Response> => {
    // Optional shared-secret gate. Active only when HEALTH_TOKEN is configured,
    // so the endpoint keeps working before the secret is set. When set, an
    // unauthenticated caller is rejected before any (paid) upstream call runs.
    const expected = deps.getEnv("HEALTH_TOKEN");
    if (expected) {
      const token = new URL(req.url).searchParams.get("token");
      if (token !== expected) {
        return new Response(
          JSON.stringify({ error: "unauthorized" }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      }
    }

    const start = Date.now();
    const result = await runHealthChecks(deps);
    return new Response(
      JSON.stringify({
        status: result.status,
        latency_ms: Date.now() - start,
        checks: result.checks,
        timestamp: new Date().toISOString(),
      }),
      {
        status: result.status === "healthy" ? 200 : 503,
        headers: { "content-type": "application/json" },
      },
    );
  };
}
