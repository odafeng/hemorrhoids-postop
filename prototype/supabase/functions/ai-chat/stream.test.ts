// Tests for the SSE relay between Anthropic and the patient's browser.
// Run: deno test supabase/functions/ai-chat/stream.test.ts
import assert from "node:assert/strict";
import { createChatStream, type StreamDeps } from "./stream.ts";

const enc = new TextEncoder();

// Builds an upstream that emits the given SSE lines, then either ends cleanly or
// throws — the latter models Anthropic dropping the connection mid-generation.
function upstreamOf(lines: string[], failWith?: Error): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < lines.length) {
        controller.enqueue(enc.encode(lines[i++] + "\n"));
        return;
      }
      if (failWith) controller.error(failWith);
      else controller.close();
    },
  });
}

function recordingDeps(overrides: Partial<StreamDeps> = {}) {
  const metrics: Array<{ status: string; error?: string; tokens?: unknown }> = [];
  const audits: unknown[] = [];
  const deps: StreamDeps = {
    model: "claude-haiku-4-5-20251001",
    ragSources: [],
    logMetrics: (status, error, tokens) => {
      metrics.push({ status, error, tokens });
      return Promise.resolve();
    },
    writeAudit: (tokens) => {
      audits.push(tokens);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { deps, metrics, audits };
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  let out = "";
  const dec = new TextDecoder();
  for await (const chunk of stream) out += dec.decode(chunk, { stream: true });
  return out;
}

const HAPPY_LINES = [
  'data: {"type":"message_start","message":{"usage":{"input_tokens":1200}}}',
  'data: {"type":"content_block_delta","delta":{"text":"傷口"}}',
  'data: {"type":"content_block_delta","delta":{"text":"照護"}}',
  'data: {"type":"message_delta","usage":{"output_tokens":42}}',
  "data: [DONE]",
];

Deno.test("relays deltas and records a success with real token counts", async () => {
  const { deps, metrics, audits } = recordingDeps();
  const out = await drain(createChatStream(upstreamOf(HAPPY_LINES), deps));

  assert.ok(out.includes("傷口"));
  assert.ok(out.includes("照護"));
  assert.ok(out.includes('"type":"done"'));
  assert.deepEqual(metrics, [{
    status: "success",
    error: undefined,
    tokens: { input: 1200, output: 42 },
  }]);
  assert.deepEqual(audits, [{ input: 1200, output: 42 }]);
});

// The blind spot: Anthropic answered 200 (so the request is billable and the
// generation already happened), then the connection died mid-stream. Before this
// test, that path wrote nothing at all — no ai_request_logs row, no audit_trail
// row, no ai_chat_logs row — so a recurring mid-stream failure was invisible in
// every table while still costing money.
Deno.test("records an error when the upstream dies mid-stream", async () => {
  const { deps, metrics } = recordingDeps();
  const out = await drain(createChatStream(
    upstreamOf(HAPPY_LINES.slice(0, 2), new Error("connection reset")),
    deps,
  ));

  assert.ok(out.includes("Stream interrupted"), "client is still told the stream broke");
  assert.equal(metrics.length, 1, "a billable request must never go unlogged");
  assert.equal(metrics[0].status, "error");
  assert.match(String(metrics[0].error), /connection reset/);
});

Deno.test("partial output is preserved in the error metrics", async () => {
  const { deps, metrics } = recordingDeps();
  await drain(createChatStream(
    upstreamOf(HAPPY_LINES.slice(0, 2), new Error("connection reset")),
    deps,
  ));

  // input_tokens arrived in message_start before the break; keeping them means
  // the cost of a broken stream is still attributable.
  assert.deepEqual(metrics[0].tokens, { input: 1200, output: 0 });
});
