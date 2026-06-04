-- matched_topic stores concatenated RAG source titles (joined by "; "), which
-- routinely exceeds 50 chars and caused saveChatLog inserts to fail with 22001.
-- The error was swallowed (console.error only), so chat logs were silently
-- dropped for RAG-answered questions. Widen to TEXT.
ALTER TABLE public.ai_chat_logs ALTER COLUMN matched_topic TYPE text;
