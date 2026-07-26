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
| Anthropic | `max_tokens:1` canary with the same `CLAUDE_API_KEY` ai-chat uses — catches **credit/usage-limit exhaustion** and revoked keys, not just a missing env var | yes |
| Supabase DB | `count` on `rag_documents` (no PII echoed) | yes |
| OpenAI | `GET /v1/models` — a bad key only degrades RAG, so it is a warning | no |
| VAPID | presence only (informational) | no |

Non-2xx (i.e. `503`) plus the per-check detail lets the monitor alert with an
actionable reason. Response body never echoes key values or patient data.

## Setup (operator steps)

1. **Supabase secret** `HEALTH_TOKEN` (done): a random string. Callers must pass
   `?token=<value>`; unauthenticated callers get `401` before any paid canary runs.
   The token has three consumers — keep them in sync when rotating: this Supabase
   secret, the **GitHub Actions secret `HEALTH_TOKEN`** (ci.yml's deploy smoke test
   curls `/health?token=…`), and the Better Stack monitor URL below.
2. **Deploy** (done, additive; does not touch ai-chat):
   ```sh
   supabase functions deploy health --no-verify-jwt
   ```
3. **Better Stack monitor**:
   - Type: HTTP(S) uptime monitor.
   - URL: `https://<project-ref>.supabase.co/functions/v1/health`
   - Auth: send the token as request header `x-health-token: <HEALTH_TOKEN>` (preferred —
     keeps the secret out of URLs and request logs). The `?token=<HEALTH_TOKEN>` query
     param also works for backward compatibility.
   - Frequency: as low as the plan allows (free ≈ 3 min — already ~10× GitHub's
     throttled cadence).
   - Down condition: any non-2xx (the endpoint returns `503` when degraded).
   - Alerts: Better Stack app push / email (or webhook to ntfy).
   - Keep the monitor + any status page **private** so the token'd URL is not exposed.

## Verify

- **Locally**: `deno test supabase/functions/health/checks.test.ts` (logic, no network).
- **Live**: `curl -H "x-health-token: <token>" "<url>"` → `200` healthy; without → `401`.
- **Alert path**: point Better Stack at a wrong token briefly → it sees `401`/down →
  phone alert. Restore after.

## Cost

The Anthropic canary is `max_tokens:1` (~$0.00002/call) → a few cents/month even
at a 1–3 min cadence.
