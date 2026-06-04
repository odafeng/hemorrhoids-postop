-- study_invites: researcher pre-generates invite tokens for each patient
-- patient-onboard Edge Function will verify token before creating patient record
-- This prevents arbitrary study_id registration

CREATE TABLE IF NOT EXISTS study_invites (
    id              SERIAL PRIMARY KEY,
    study_id        VARCHAR(20) UNIQUE NOT NULL,
    invite_token    VARCHAR(64) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'used', 'expired', 'revoked')),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    used_by_user_id UUID REFERENCES auth.users(id),
    used_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID REFERENCES auth.users(id)
);

-- Index for token lookup during onboarding
CREATE INDEX IF NOT EXISTS idx_study_invites_token ON study_invites(invite_token) WHERE status = 'pending';

-- RLS: only researchers/PI can manage invites, system can read for validation
ALTER TABLE study_invites ENABLE ROW LEVEL SECURITY;

-- Researchers can view and create invites
DROP POLICY IF EXISTS "researchers_manage_invites" ON study_invites;
CREATE POLICY "researchers_manage_invites" ON study_invites
    FOR ALL
    USING (get_user_role() IN ('researcher', 'pi'))
    WITH CHECK (get_user_role() IN ('researcher', 'pi'));

-- Patients cannot access this table directly (validation happens in Edge Function via service_role)
