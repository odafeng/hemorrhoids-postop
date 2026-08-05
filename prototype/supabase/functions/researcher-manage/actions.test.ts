import assert from "node:assert/strict";
import { resendResearcherActivation, type ResendActivationDeps } from "./actions.ts";

const staffUser = {
  id: "researcher-1",
  email: "researcher@example.com",
  app_metadata: { role: "researcher" },
};

function makeDeps(overrides: Partial<ResendActivationDeps> = {}) {
  const sent: string[] = [];
  const audited: Array<Record<string, unknown>> = [];
  const deps: ResendActivationDeps = {
    getUserById: () => Promise.resolve({ user: staffUser, error: null }),
    sendRecoveryEmail: (email) => {
      sent.push(email);
      return Promise.resolve({ error: null });
    },
    writeAudit: (detail) => {
      audited.push(detail);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { deps, sent, audited };
}

Deno.test("重新寄送只使用 server 查出的研究人員 email", async () => {
  const { deps, sent, audited } = makeDeps();

  const result = await resendResearcherActivation("researcher-1", "pi-1", deps);

  assert.equal(result.status, 200);
  assert.deepEqual(sent, ["researcher@example.com"]);
  assert.deepEqual(audited, [{
    actor_id: "pi-1",
    target_id: "researcher-1",
    target_email: "researcher@example.com",
  }]);
});

Deno.test("不能替 patient 帳號寄送研究人員啟用信", async () => {
  const { deps, sent } = makeDeps({
    getUserById: () => Promise.resolve({
      user: { ...staffUser, app_metadata: { role: "patient" } },
      error: null,
    }),
  });

  const result = await resendResearcherActivation("patient-1", "pi-1", deps);

  assert.equal(result.status, 403);
  assert.deepEqual(sent, []);
});

Deno.test("Supabase default SMTP 拒絕外部信箱時回傳可操作訊息", async () => {
  const { deps } = makeDeps({
    sendRecoveryEmail: () => Promise.resolve({
      error: { code: "email_address_not_authorized", message: "not authorized" },
    }),
  });

  const result = await resendResearcherActivation("researcher-1", "pi-1", deps);

  assert.equal(result.status, 503);
  assert.match(result.body.error ?? "", /Custom SMTP/);
});

Deno.test("寄信 rate limit 會回傳 429", async () => {
  const { deps } = makeDeps({
    sendRecoveryEmail: () => Promise.resolve({
      error: { code: "over_email_send_rate_limit", message: "rate limit" },
    }),
  });

  const result = await resendResearcherActivation("researcher-1", "pi-1", deps);

  assert.equal(result.status, 429);
  assert.match(result.body.error ?? "", /稍後/);
});
