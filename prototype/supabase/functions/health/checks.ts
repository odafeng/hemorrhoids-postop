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

// Anthropic canary: a real max_tokens:1 generation, which is what catches an
// exhausted credit balance — the failure mode that leaves the site up but breaks
// the chat. It bills HEALTH_CLAUDE_API_KEY when set, so the Anthropic console
// separates ~940 probes/day of monitoring spend from real patient usage; without
// that split, any non-zero bill looks like patients using the intervention.
// Credit exhaustion is org-wide, so a same-org monitoring key still trips on it.
// What the split *does* lose is a revoked chat key — checkChatKey covers that.
async function checkAnthropic(deps: HealthDeps): Promise<string> {
  const key = deps.getEnv("HEALTH_CLAUDE_API_KEY") || deps.getEnv("CLAUDE_API_KEY");
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
    if (res.ok) return "ok";
    // Surface the API's own message (e.g. "credit balance is too low") so the
    // alert is actionable — HTTP 400 alone can't tell a bad payload from an
    // exhausted account.
    let detail = "";
    try {
      const j = await res.json();
      detail = typeof j?.error?.message === "string" ? j.error.message : "";
    } catch { /* non-JSON body */ }
    return detail ? `error: HTTP ${res.status} – ${detail.slice(0, 140)}` : `error: HTTP ${res.status}`;
  } catch (e) {
    return `error: ${msg(e)}`;
  }
}

// Validity probe for the key ai-chat itself uses. GET /v1/models is authenticated
// but bills nothing, so this restores the revoked/invalid-key coverage that moving
// the paid canary onto a separate key would otherwise have dropped. Fatal: a 401
// here means the chat is dead no matter how healthy the canary looks.
async function checkChatKey(deps: HealthDeps): Promise<string> {
  const key = deps.getEnv("CLAUDE_API_KEY");
  if (!key) return "missing";
  try {
    const res = await deps.fetch("https://api.anthropic.com/v1/models?limit=1", {
      method: "GET",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
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
  const [anthropic, chatKey, database, openai] = await Promise.all([
    checkAnthropic(deps),
    checkChatKey(deps),
    checkDatabase(deps),
    checkOpenAI(deps),
  ]);

  const checks: Record<string, string> = {
    anthropic,
    chat_key: chatKey,
    database,
    openai,
    vapid: deps.getEnv("VAPID_PUBLIC_KEY") ? "configured" : "missing",
  };

  // Fatal to the chat feature: generation (incl. credit balance), the key ai-chat
  // signs with, and the DB. OpenAI embeddings degrade gracefully, so they are not.
  const status = anthropic === "ok" && chatKey === "ok" && database === "ok"
    ? "healthy"
    : "degraded";
  return { status, checks };
}

export function createHandler(deps: HealthDeps) {
  return async (req: Request): Promise<Response> => {
    // Optional shared-secret gate. Active only when HEALTH_TOKEN is configured,
    // so the endpoint keeps working before the secret is set. When set, an
    // unauthenticated caller is rejected before any (paid) upstream call runs.
    const expected = deps.getEnv("HEALTH_TOKEN");
    if (expected) {
      // Prefer the header (keeps the secret out of URLs / request logs); fall
      // back to the query param for backward compatibility.
      const token = req.headers.get("x-health-token") ??
        new URL(req.url).searchParams.get("token");
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
