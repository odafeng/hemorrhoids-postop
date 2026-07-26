// Supabase Edge Function: health
// Active liveness probe for the ai-chat dependency chain: Anthropic generation
// (with a max_tokens:1 canary that catches credit exhaustion), Supabase DB, and
// OpenAI embeddings (non-fatal). Returns 200 healthy / 503 degraded.
// Deploy: supabase functions deploy health --no-verify-jwt
// Gate: set the HEALTH_TOKEN secret; callers must pass ?token=<value>.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createHandler, type HealthDeps } from "./checks.ts";

const client = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const deps: HealthDeps = {
  getEnv: (name) => Deno.env.get(name),
  fetch: (input, init) => fetch(input, init),
  dbCount: async (table) => {
    const { count, error } = await client
      .from(table)
      .select("*", { count: "exact", head: true });
    return { count, error };
  },
};

Deno.serve(createHandler(deps));
