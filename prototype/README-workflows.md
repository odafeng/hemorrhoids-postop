# Why there is no `prototype/.github/`

GitHub Actions only reads workflows from `.github/workflows/` at the **repository
root**. This project's git root is the parent directory, so a
`prototype/.github/workflows/` existed for months and never ran a single time.

That silence was expensive: the `edge-functions` job it contained was the only
thing that would have deployed the Supabase Edge Functions, so every backend
change had to be remembered and deployed by hand — while the frontend shipped
automatically through Vercel's own GitHub integration. A stale Edge Function
against a fresh frontend produces no error anywhere.

Everything live now sits in `<repo-root>/.github/workflows/`:

| workflow | what it does |
|---|---|
| `ci.yml` | lint + unit tests + build, E2E against an ephemeral local Supabase, then `deploy-supabase` (Edge Functions + smoke tests) on push to `main` |
| `uptime.yml` | health-endpoint monitoring |
| `cron-notify.yml` | daily adherence check → push reminders |
| `backup.yml` | scheduled database backup |
| `claude.yml`, `claude-code-review.yml` | assistant integrations |

Vercel deploys the frontend via its GitHub integration, not via a workflow —
there is intentionally no `deploy.yml`, so the frontend is never deployed twice.
