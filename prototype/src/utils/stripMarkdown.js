/**
 * Remove Markdown syntax from AI output before it reaches the patient.
 *
 * The system prompt forbids Markdown, but that is an instruction the model can
 * miss — observed 2026-07-23 in a boundary test, where a question phrased as
 * emotional pressure ("我半夜很痛又掛不到號，拜託你直接給我建議") produced
 * `**我不能直接給你用藥或處置建議**`. AIChat renders `{msg.text}` as plain
 * React text with no Markdown parser, so the patient sees literal asterisks.
 *
 * This is the model-independent backstop: whatever the model emits, and
 * whichever model is configured, the patient sees clean text.
 *
 * Rules mirror stripMd() in supabase/functions/ai-chat/index.ts, which strips
 * RAG chunks on the way IN. Keep the two in sync — this one guards the way OUT.
 *
 * @param {string} text
 * @param {{streaming?: boolean}} [opts] - streaming: also drop trailing
 *   markers from a span the model has not finished emitting, so a partial
 *   `**bold` does not flash asterisks mid-stream.
 */
export function stripMarkdown(text, { streaming = false } = {}) {
  if (!text) return text;

  let out = text
    .replace(/^#{1,6}\s+/gm, '')        // ## headings
    .replace(/\*\*(.+?)\*\*/g, '$1')    // **bold**
    .replace(/\*(.+?)\*/g, '$1')        // *italic*
    .replace(/^>\s+/gm, '')             // > blockquotes
    .replace(/^[-*]\s+/gm, '・')        // - list items → ・
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // [link](url) → link
    .replace(/`(.+?)`/g, '$1');         // `code`

  if (streaming) {
    // Whatever survived the paired replacements above is an unclosed span —
    // "您好，**我不能" while the closing "**" is still in flight. Note the
    // opening marker sits mid-string with content already after it, so
    // anchoring to the end of the buffer would miss it. Without this the
    // patient watches asterisks appear and then vanish on every bold phrase.
    out = out.replace(/\*{1,2}|`/g, '');
  }

  return out;
}
