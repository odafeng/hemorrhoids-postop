# Audit Trail Event Reference

All critical system events are logged to the `audit_trail` table.  
This document serves as reference for IRB applications and paper methods sections.

## Audited Events

| action                   | actor_role | trigger source             | description                               |
|--------------------------|------------|----------------------------|-------------------------------------------|
| `report.submit`          | patient    | DB trigger (INSERT/UPDATE) | Patient submits or updates a symptom report |
| `alert.create`           | system     | DB trigger (INSERT)        | Alert rule engine creates a new alert      |
| `alert.acknowledge`      | researcher | Client-side (RLS)          | Researcher acknowledges an alert           |
| `patient.onboard`        | patient    | Edge Function              | New patient record created via onboarding  |
| `ai.chat_request`        | patient    | Edge Function              | Patient uses AI 衛教 chatbot              |
| `researcher.review_chat` | researcher | Client-side (RLS)          | Researcher reviews an AI chat log          |
| `researcher.batch_review`| researcher | Client-side (RLS)          | Researcher batch-reviews multiple AI chats  |
| `cron.check_adherence`   | system     | Edge Function (cron)       | Daily adherence check with reminder count  |

## Fields

Each `audit_trail` row contains:

- `actor_id` — UUID of the acting user (NULL for system events)
- `actor_role` — patient / researcher / pi / system
- `action` — event type (see table above)
- `resource` — target table name
- `resource_id` — study_id or record identifier
- `detail` — JSONB with action-specific data
- `ip_address` — client IP (where available)
- `created_at` — timestamp

## PII audit (pii_access_log)

| event         | status | notes                                                    |
|---------------|--------|----------------------------------------------------------|
| `pii.change`  | live since 2026-08-13 | `trg_audit_pii_change` on `pii_patients` logs INSERT/UPDATE/DELETE. Pass an explanation with `SET LOCAL app.access_reason = '...'` before the write. |
| `pii.access`  | NOT audited | PI decrypts patient PII. **A trigger cannot do this** — Postgres has no SELECT trigger, and the event is a `SELECT ... pgp_sym_decrypt(...)`. Auditing reads requires routing them through a SECURITY DEFINER function and revoking direct SELECT on `pii_patients`; deferred on 2026-08-13 (no permission changes during enrolment). Note that even then, `service_role` and superuser bypass it. |

An earlier version of this file said `pii.access` "needs trigger on pii_access_log".
That was wrong twice over: the trigger would belong on `pii_patients`, not on the log
table, and no trigger can capture a read at all.

## Events NOT yet audited (future)

| event              | notes                                          |
|--------------------|------------------------------------------------|
| `pii.export`       | Future CSV export tool                         |
| `patient.withdraw`  | Patient withdrawn from study                   |
