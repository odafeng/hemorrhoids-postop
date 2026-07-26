# `health` — ai-chat uptime probe

Active liveness check for the ai-chat dependency chain. Returns `200` healthy /
`503` degraded. Probed every ~5 min by `.github/workflows/uptime.yml`, which
reports to Healthchecks.io for phone alerting + a dead man's switch.

Design: `docs/superpowers/specs/2026-07-26-ai-chat-uptime-monitoring-design.md`

## What it checks

| Check | How | Fatal? |
|-------|-----|--------|
| Anthropic | `max_tokens:1` canary with the same `CLAUDE_API_KEY` ai-chat uses — catches **credit exhaustion** and revoked keys, not just a missing env var | yes |
| Supabase DB | `count` on `rag_documents` (no PII echoed) | yes |
| OpenAI | `GET /v1/models` — a bad key only degrades RAG, so it is a warning | no |
| VAPID | presence only (informational) | no |

Response body: `{ status, latency_ms, checks, timestamp }`. Never echoes key
values or patient data.

## Setup (operator steps — not done automatically)

1. **Set the function secrets** (Supabase → Edge Functions → Secrets):
   - `HEALTH_TOKEN` — a random string. Once set, callers must pass `?token=<value>`;
     unauthenticated callers get `401` **before** any paid Anthropic call runs.
   - (`CLAUDE_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
     already exist for ai-chat.)

2. **Deploy the function** (additive; does not touch ai-chat):
   ```sh
   supabase functions deploy health --no-verify-jwt
   ```

3. **Create a Healthchecks.io check**: period 5 min, grace 6–8 min. Copy its
   ping URL (`https://hc-ping.com/<uuid>`). Wire its Integrations to **ntfy**
   (or the HC app / email) so alerts reach the PI's phone.

4. **Set the GitHub Actions secrets** (repo → Settings → Secrets → Actions):
   - `HEALTH_TOKEN` — same value as step 1.
   - `HC_PING_URL` — the Healthchecks.io ping URL from step 3.
   - `SUPABASE_URL` — already configured.

## Verify

- **Locally**: `deno test supabase/functions/health/checks.test.ts` (logic, no network).
- **End to end**: run the `Uptime Monitor` workflow via *Run workflow*
  (`workflow_dispatch`) → Healthchecks.io shows a ping and goes "up".
- **Alert path**: temporarily set the GitHub `HEALTH_TOKEN` secret to a wrong
  value → the probe gets `401`/`503` → HC `/fail` → **phone alert**. Restore after.

## Cost

The Anthropic canary is `max_tokens:1` (~$0.00002/call) → about **$0.2–0.4/month**
at a 5-min cadence. GitHub Actions minutes are free (public repo).
