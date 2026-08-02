# `health` — ai-chat uptime probe

Active liveness check for the ai-chat dependency chain. Returns `200` healthy /
`503` degraded. Probed by a **Better Stack** uptime monitor that hits the
token-gated endpoint directly and alerts the PI's phone.

Design: `docs/superpowers/specs/2026-07-26-ai-chat-uptime-monitoring-design.md`

> **History:** originally probed by a GitHub Actions `*/5` cron reporting to
> Healthchecks.io. GitHub throttled the cron to ~29-min actual cadence, so HC's
> 5-min dead man's switch flapped UP/DOWN constantly. Switched to Better Stack
> (active prober, not cron-driven) on 2026-07-26.

## What it checks

| Check | How | Fatal? |
|-------|-----|--------|
| Anthropic | `max_tokens:1` canary billed to `HEALTH_CLAUDE_API_KEY` (falls back to `CLAUDE_API_KEY`) — catches **credit/usage-limit exhaustion**, which is org-wide and so trips on either key | yes |
| chat_key | `GET /v1/models` on `CLAUDE_API_KEY` itself — authenticated but **bills nothing**; covers the revoked/invalid-key case the split key would otherwise hide | yes |
| Supabase DB | `count` on `rag_documents` (no PII echoed) | yes |
| OpenAI | `GET /v1/models` — a bad key only degrades RAG, so it is a warning | no |
| VAPID | presence only (informational) | no |

### Why two Anthropic keys

The probe runs ~940×/day. Billed to the same key ai-chat uses, that spend is
indistinguishable in the Anthropic console from patients using the intervention —
on 2026-08-02 it prompted exactly that question ("why is there API spend when the
review queue is empty?"). Splitting the paid canary onto its own key makes the
console self-explanatory and keeps the study's reported patient-usage figures clean.

The cost of the split is that a revoked `CLAUDE_API_KEY` would no longer show up in
the canary — hence the separate `chat_key` check, which is free. Credit exhaustion
is an **organization-level** failure, so create `HEALTH_CLAUDE_API_KEY` in the *same
org and workspace* as `CLAUDE_API_KEY` or that coverage is lost too.

Non-2xx (i.e. `503`) plus the per-check detail lets the monitor alert with an
actionable reason. Response body never echoes key values or patient data.

## Setup (operator steps)

1. **Supabase secret** `HEALTH_TOKEN` (done): a random string. Callers must pass
   `?token=<value>`; unauthenticated callers get `401` before any paid canary runs.
   The token has three consumers — keep them in sync when rotating: this Supabase
   secret, the **GitHub Actions secret `HEALTH_TOKEN`** (ci.yml's deploy smoke test
   curls `/health?token=…`), and the Better Stack monitor URL below.
2. **Supabase secret** `HEALTH_CLAUDE_API_KEY` (optional): a second Anthropic key,
   created in the **same org and workspace** as `CLAUDE_API_KEY`, used only for the
   paid canary. Unset is safe — the canary falls back to `CLAUDE_API_KEY` and the
   endpoint behaves exactly as before, just without the billing separation.
   ```sh
   supabase secrets set HEALTH_CLAUDE_API_KEY=sk-ant-... --project-ref <ref>
   ```
3. **Deploy** (done, additive; does not touch ai-chat):
   ```sh
   supabase functions deploy health --no-verify-jwt
   ```
4. **Better Stack monitor**:
   - Type: HTTP(S) uptime monitor.
   - URL: `https://<project-ref>.supabase.co/functions/v1/health`
   - Auth: send the token as request header `x-health-token: <HEALTH_TOKEN>` (preferred —
     keeps the secret out of URLs and request logs). The `?token=<HEALTH_TOKEN>` query
     param also works for backward compatibility.
   - Frequency: **5 minutes**. Measured on 2026-08-02 the probe was running every
     ~90s (234 invocations in 6h) — well past what a low-volume pilot needs, and
     every probe is a billed Anthropic call. The design spec's own target is "pilot
     可接受約 5 分鐘"; 5 min cuts the spend to a third with no meaningful loss of
     detection speed at this enrolment volume.
   - Down condition: any non-2xx (the endpoint returns `503` when degraded).
   - Alerts: Better Stack app push / email (or webhook to ntfy).
   - Keep the monitor + any status page **private** so the token'd URL is not exposed.

## Verify

- **Locally**: `deno test supabase/functions/health/checks.test.ts` (logic, no network).
- **Live**: `curl -H "x-health-token: <token>" "<url>"` → `200` healthy; without → `401`.
- **Alert path**: point Better Stack at a wrong token briefly → it sees `401`/down →
  phone alert. Restore after.

## Cost

The Anthropic canary is `max_tokens:1` (~$0.00002/call); the `chat_key` probe is a
plain `GET` and costs nothing. Measured 2026-08-02: at a ~90s cadence that is ~940
calls/day ≈ US$0.02/day. At the 5-minute cadence above it is ~290 calls/day.

Small in absolute terms, but it is the *only* Anthropic spend during a quiet
enrolment period — which is why it gets its own key (see above). To answer "how much
did patients actually use the AI?", read `ai_request_logs` (per-request
`input_tokens` / `output_tokens`), not the Anthropic console.
