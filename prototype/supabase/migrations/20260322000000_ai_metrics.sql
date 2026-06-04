-- AI request metrics table for monitoring latency, failures, and usage
CREATE TABLE IF NOT EXISTS ai_request_logs (
    id              SERIAL PRIMARY KEY,
    user_id         UUID REFERENCES auth.users(id),
    study_id        VARCHAR(20),
    latency_ms      INT,
    status          VARCHAR(10) NOT NULL, -- 'success', 'error', 'timeout'
    error_message   TEXT,
    model           VARCHAR(50) DEFAULT 'claude-sonnet-4-20250514',
    input_tokens    INT,
    output_tokens   INT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ai_request_logs ENABLE ROW LEVEL SECURITY;

-- Only researchers/PI can read AI metrics
CREATE POLICY "researcher_read_ai_metrics" ON ai_request_logs
  FOR SELECT
  USING (
    get_user_role() IN ('researcher', 'pi')
  );

-- Service role (Edge Function) inserts — no RLS needed for insert
-- Edge Functions use service_role key which bypasses RLS
