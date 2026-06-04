-- Client-side error logging table for monitoring
CREATE TABLE client_error_logs (
    id              SERIAL PRIMARY KEY,
    error_message   TEXT NOT NULL,
    error_stack     TEXT,
    context         TEXT,
    user_agent      TEXT,
    url             TEXT,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE client_error_logs ENABLE ROW LEVEL SECURITY;

-- Anyone can insert (errors happen before/without auth)
CREATE POLICY "anyone_can_insert_errors" ON client_error_logs
  FOR INSERT WITH CHECK (true);

-- Only PI/researcher can read error logs
CREATE POLICY "researcher_read_errors" ON client_error_logs
  FOR SELECT
  USING (get_user_role() IN ('researcher', 'pi'));
