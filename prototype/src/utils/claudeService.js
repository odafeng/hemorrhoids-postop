// Claude AI Service — calls Supabase Edge Function with SSE streaming
// In production: API failure shows error, no mock fallback (medical safety)
// In demo mode: uses mockAI directly

import { getAIResponse as getMockResponse } from './mockAI';
import { logError } from './errorLogger';

function getAIChatUrl() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) return null;
  return `${supabaseUrl}/functions/v1/ai-chat`;
}

async function getHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (anonKey) {
    headers['apikey'] = anonKey;
    const { default: supabase } = await import('./supabaseClient');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('Not authenticated');
    }
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  return headers;
}

/**
 * Get AI response with streaming (SSE)
 * @param {string} question
 * @param {object} options
 * @param {function} onChunk - callback(textSoFar) called on each delta
 * @returns {Promise<{text: string, source: string}>}
 */
export async function getClaudeResponse(question, options = {}, onChunk = null) {
  const { recentSymptoms = null, conversationHistory = [], isDemo = false } = options;

  if (isDemo || !getAIChatUrl()) {
    const text = getMockResponse(question);
    return { text, source: 'mock' };
  }

  try {
    const body = { question };
    if (recentSymptoms) body.recentSymptoms = recentSymptoms;
    if (conversationHistory.length > 0) body.history = conversationHistory.slice(-10);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(getAIChatUrl(), {
      method: 'POST',
      headers: await getHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      logError(new Error(`Claude API ${res.status}: ${err.error || 'unknown'}`), {
        type: 'ai_api_error', severity: 'fatal', component: 'ai_chat',
      });
      return {
        text: 'AI 衛教暫時不可用，請稍後再試。如有緊急狀況，請聯絡您的醫療團隊。',
        source: 'error',
      };
    }

    // SSE streaming
    if (onChunk && res.headers.get('content-type')?.includes('text/event-stream')) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let ragSources = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'delta' && event.text) {
              fullText += event.text;
              onChunk(fullText);
            }
            if (event.type === 'done' && event.sources) {
              ragSources = event.sources;
            }
          } catch { /* skip */ }
        }
      }

      return { text: fullText || '抱歉，目前無法回覆，請稍後再試。', source: 'claude', ragSources };
    }

    // Fallback: non-streaming JSON response
    const data = await res.json();
    return { text: data.response, source: 'claude' };
  } catch (err) {
    const isTimeout = err?.name === 'AbortError';
    console.error('Claude service error:', isTimeout ? 'timeout' : err);
    logError(err, {
      type: isTimeout ? 'ai_timeout' : 'ai_network_error',
      severity: 'fatal', component: 'ai_chat',
    });
    return {
      text: isTimeout
        ? 'AI 回覆逾時，請稍後再試。如有緊急狀況，請聯絡您的醫療團隊。'
        : 'AI 衛教暫時不可用，請稍後再試。如有緊急狀況，請聯絡您的醫療團隊。',
      source: 'error',
    };
  }
}
