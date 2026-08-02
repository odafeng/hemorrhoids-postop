// Supabase Edge Function: ai-chat
// Proxies requests to Claude API without exposing the API key
// Deploy: supabase functions deploy ai-chat

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { SYSTEM_PROMPT } from "./_prompt.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createChatStream } from "./stream.ts";

// Simple in-memory rate limiting (per edge instance)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Rate limiting
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(clientIp)) {
    return new Response(
      JSON.stringify({ error: "請求過於頻繁，請稍後再試", fallback: true }),
      {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Authenticate user via JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Unauthorized — please log in" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Verify JWT is a real user (not just anon key)
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    console.error("Auth failed:", authError?.message || "no user", "header starts with:", authHeader.substring(0, 20));
    return new Response(
      JSON.stringify({ error: "Invalid or expired session" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Metrics logging helper
  const startTime = Date.now();
  const logMetrics = async (status: string, error?: string, tokens?: { input: number, output: number }) => {
    try {
      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await adminClient.from("ai_request_logs").insert({
        user_id: user.id,
        study_id: user.user_metadata?.study_id || null,
        latency_ms: Date.now() - startTime,
        status,
        error_message: error || null,
        model: "claude-haiku-4-5-20251001",
        input_tokens: tokens?.input || null,
        output_tokens: tokens?.output || null,
      });
    } catch (e) {
      console.warn("Failed to log AI metrics:", e);
    }
  };

  try {
    const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY");
    if (!CLAUDE_API_KEY) {
      console.error("CLAUDE_API_KEY not configured");
      await logMetrics("error", "CLAUDE_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { question, recentSymptoms, history } = await req.json();

    if (!question || typeof question !== "string") {
      return new Response(
        JSON.stringify({ error: "question is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let userMessage = question.trim();
    if (recentSymptoms) {
      userMessage += `\n\n[病人近期症狀摘要（去識別化）：${JSON.stringify(recentSymptoms)}]`;
    }

    // --- RAG Retrieval ---
    let ragContext = "";
    let ragSources: Array<{title: string, source_file: string, similarity: number}> = [];
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (OPENAI_API_KEY) {
      try {
        // 1. Embed the user question
        const embRes = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: question.trim().slice(0, 2000),
          }),
        });

        if (embRes.ok) {
          const embData = await embRes.json();
          const queryEmbedding = embData.data?.[0]?.embedding;

          if (queryEmbedding) {
            // 2. Query pgvector for top-3 similar chunks (threshold 0.5)
            const adminClient = createClient(
              Deno.env.get("SUPABASE_URL")!,
              Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
            );
            const { data: docs, error: matchError } = await adminClient.rpc(
              "match_documents",
              {
                query_embedding: JSON.stringify(queryEmbedding),
                match_threshold: 0.5,
                match_count: 3,
              }
            );

            if (!matchError && docs && docs.length > 0) {
              // 3. Store sources for citation
              ragSources = docs.map((d: { title: string; source_file: string; similarity: number }) => ({
                title: d.title,
                source_file: d.source_file,
                similarity: Math.round(d.similarity * 100) / 100,
              }));

              // 4. Strip markdown from content to prevent Claude from mimicking markdown format
              const stripMd = (text: string) => text
                .replace(/^#{1,6}\s+/gm, '')      // ## headings
                .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold**
                .replace(/\*(.+?)\*/g, '$1')        // *italic*
                .replace(/^>\s+/gm, '')             // > blockquotes
                .replace(/^[-*]\s+/gm, '・')        // - list items → ・
                .replace(/\[(.+?)\]\(.+?\)/g, '$1') // [link](url) → link
                .replace(/`(.+?)`/g, '$1');          // `code`

              // 5. Format as clean plain-text context
              ragContext = "\n\n---\n以下是衛教知識庫中與病人問題最相關的參考資料，請優先參考這些資訊回答（注意：回覆時請用純文字，絕對不要使用 Markdown 語法如 ## ** - 等符號）：\n\n"
                + docs.map((d: { title: string; content: string; source_file: string; similarity: number }, i: number) =>
                  `【參考${i + 1}】${d.title}\n${stripMd(d.content)}`
                ).join("\n\n");
              console.log(`[RAG] Retrieved ${docs.length} chunks, top similarity: ${docs[0].similarity.toFixed(3)}`);
            } else {
              console.log("[RAG] No matching documents found", matchError?.message || "");
            }
          }
        } else {
          console.warn("[RAG] OpenAI embedding failed:", embRes.status);
        }
      } catch (ragErr) {
        console.warn("[RAG] Retrieval failed (non-fatal):", ragErr);
      }
    }

    // Build multi-turn messages from conversation history
    // Limit: last 10 turns, max 4000 chars total to stay within token budget
    const messages: Array<{role: string, content: string}> = [];
    if (Array.isArray(history) && history.length > 0) {
      let totalChars = 0;
      const MAX_HISTORY_CHARS = 4000;
      const recentHistory = history.slice(-10);
      for (const msg of recentHistory) {
        const content = typeof msg.text === 'string' ? msg.text.slice(0, 500) : '';
        if (totalChars + content.length > MAX_HISTORY_CHARS) break;
        if (msg.role === 'user') {
          messages.push({ role: 'user', content });
        } else if (msg.role === 'ai') {
          messages.push({ role: 'assistant', content });
        }
        totalChars += content.length;
      }
    }
    messages.push({ role: "user", content: userMessage });

    // Inject RAG context into system prompt
    const systemPrompt = ragContext
      ? SYSTEM_PROMPT + ragContext
      : SYSTEM_PROMPT;

    const MODEL = "claude-haiku-4-5-20251001";

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        stream: true,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Claude API error:", response.status, errText);
      await logMetrics("error", `Claude ${response.status}: ${errText}`);
      return new Response(
        JSON.stringify({ error: "AI service unavailable" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Stream SSE to client (relay logic lives in stream.ts so its failure paths
    // are testable without a live Anthropic connection).
    const stream = createChatStream(response.body!, {
      model: MODEL,
      ragSources,
      logMetrics,
      writeAudit: async ({ input, output }) => {
        const adminClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
        await adminClient.from("audit_trail").insert({
          actor_id: user.id,
          actor_role: user.user_metadata?.role || "patient",
          action: "ai.chat_request",
          resource: "ai_chat_logs",
          resource_id: user.user_metadata?.study_id || null,
          detail: {
            input_tokens: input,
            output_tokens: output,
            latency_ms: Date.now() - startTime,
            model: MODEL,
          },
        });
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    console.error("Edge function error:", err);
    await logMetrics("error", err.message || "Internal error");
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
