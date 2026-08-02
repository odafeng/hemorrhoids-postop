// SSE relay: re-emits Anthropic's stream to the patient's browser as {delta}
// events, then a {done} event carrying the RAG sources.
//
// Split out of index.ts so the failure paths are testable without a live
// Anthropic connection — the mid-stream break in particular, which is billable
// (Anthropic already answered 200 and generated) but produced no record at all.

export interface StreamDeps {
  model: string;
  ragSources: unknown[];
  logMetrics: (
    status: string,
    error?: string,
    tokens?: { input: number; output: number },
  ) => Promise<void>;
  writeAudit: (tokens: { input: number; output: number }) => Promise<void>;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createChatStream(
  upstream: ReadableStream<Uint8Array>,
  deps: StreamDeps,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let inputTokens = 0;
  let outputTokens = 0;

  return new ReadableStream({
    async start(controller) {
      try {
        const reader = upstream.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") continue;

            try {
              const event = JSON.parse(jsonStr);

              if (event.type === "content_block_delta" && event.delta?.text) {
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ type: "delta", text: event.delta.text })}\n\n`,
                ));
              }

              if (event.type === "message_delta" && event.usage) {
                outputTokens = event.usage.output_tokens || 0;
              }

              if (event.type === "message_start" && event.message?.usage) {
                inputTokens = event.message.usage.input_tokens || 0;
              }
            } catch {
              // skip unparseable lines
            }
          }
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: "done",
          sources: deps.ragSources.length > 0 ? deps.ragSources : undefined,
          model: deps.model,
        })}\n\n`));

        // Awaited before close, not fired-and-forgotten after it: an edge isolate
        // can be torn down as soon as the response completes, which silently drops
        // background inserts. The client already has every token by this point, so
        // the added wait is invisible to the patient.
        await deps.logMetrics("success", undefined, {
          input: inputTokens,
          output: outputTokens,
        });
        try {
          await deps.writeAudit({ input: inputTokens, output: outputTokens });
        } catch (e) {
          console.warn("Failed to write AI audit trail:", e);
        }
        controller.close();
      } catch (streamErr) {
        console.error("Stream error:", streamErr);
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: "error", message: "Stream interrupted" })}\n\n`,
        ));
        // Anthropic already answered 200 and generated, so this request is billed
        // whether or not it reached the patient. Logging it here is what keeps
        // ai_request_logs a complete record of spend.
        await deps.logMetrics("error", msg(streamErr), {
          input: inputTokens,
          output: outputTokens,
        });
        controller.close();
      }
    },
  });
}
