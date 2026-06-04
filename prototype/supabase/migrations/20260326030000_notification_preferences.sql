-- notification_preferences: sync notification settings across PWA/web/devices
-- Replaces localStorage-only notification_prefs

CREATE TABLE IF NOT EXISTS notification_preferences (
    id          SERIAL PRIMARY KEY,
    study_id    VARCHAR(20) UNIQUE NOT NULL REFERENCES patients(study_id),
    enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    hour        INTEGER NOT NULL DEFAULT 20 CHECK (hour BETWEEN 0 AND 23),
    minute      INTEGER NOT NULL DEFAULT 0 CHECK (minute BETWEEN 0 AND 59),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Patients can read/write own preferences
DROP POLICY IF EXISTS "patients_own_notif_prefs" ON notification_preferences;
CREATE POLICY "patients_own_notif_prefs" ON notification_preferences
    FOR ALL
    USING (study_id = get_user_study_id())
    WITH CHECK (study_id = get_user_study_id());

-- Researchers can read all
DROP POLICY IF EXISTS "researchers_read_notif_prefs" ON notification_preferences;
CREATE POLICY "researchers_read_notif_prefs" ON notification_preferences
    FOR SELECT
    USING (get_user_role() IN ('researcher', 'pi'));
