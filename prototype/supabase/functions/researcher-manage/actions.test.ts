import assert from "node:assert/strict";
import { resetResearcherInitialPassword, type ResetInitialPasswordDeps } from "./actions.ts";

const NOW = "2026-08-12T05:30:00.000Z";

const staffUser = {
  id: "researcher-1",
  email: "researcher@example.com",
  app_metadata: { role: "researcher" },
  user_metadata: {
    display_name: "王研究",
    invited_at: "2026-08-04T11:33:57.914Z",
    password_set_at: "2026-08-05T10:20:00.000Z",
  },
};

function makeDeps(overrides: Partial<ResetInitialPasswordDeps> = {}) {
  const applied: Array<{ userId: string; password: string; meta: Record<string, unknown> }> = [];
  const audited: Array<Record<string, unknown>> = [];
  const deps: ResetInitialPasswordDeps = {
    getUserById: () => Promise.resolve({ user: staffUser, error: null }),
    applyInitialPassword: (userId, password, meta) => {
      applied.push({ userId, password, meta });
      return Promise.resolve({ error: null });
    },
    writeAudit: (detail) => {
      audited.push(detail);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { deps, applied, audited };
}

Deno.test("重設初始密碼會套用到 server 查出的帳號", async () => {
  const { deps, applied, audited } = makeDeps();

  const result = await resetResearcherInitialPassword("researcher-1", "pi-1", "temp-pass-1234", NOW, deps);

  assert.equal(result.status, 200);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].userId, "researcher-1");
  assert.equal(applied[0].password, "temp-pass-1234");
  assert.deepEqual(audited, [{
    actor_id: "pi-1",
    target_id: "researcher-1",
    target_email: "researcher@example.com",
  }]);
});

// The whole point of the reset: the PI now knows this password, so the account
// must go back to demanding a replacement on the next login.
Deno.test("清掉 password_set_at，讓對方下次登入被迫改密碼", async () => {
  const { deps, applied } = makeDeps();

  await resetResearcherInitialPassword("researcher-1", "pi-1", "temp-pass-1234", NOW, deps);

  assert.equal(applied[0].meta.password_set_at, null);
  // Untouched fields survive — a reset must not wipe the display name.
  assert.equal(applied[0].meta.display_name, "王研究");
  assert.equal(applied[0].meta.invited_at, "2026-08-04T11:33:57.914Z");
});

// The founding PI account predates invited_at, so clearing password_set_at
// alone would leave nothing for useAuth to key on and the reset would silently
// skip the forced change.
Deno.test("帳號沒有 invited_at 時補蓋一個，否則強制改密碼不會觸發", async () => {
  const { deps, applied } = makeDeps({
    getUserById: () => Promise.resolve({
      user: {
        ...staffUser,
        app_metadata: { role: "pi" },
        user_metadata: { display_name: "黃士峯" },
      },
      error: null,
    }),
  });

  await resetResearcherInitialPassword("pi-2", "pi-1", "temp-pass-1234", NOW, deps);

  assert.equal(applied[0].meta.invited_at, NOW);
  assert.equal(applied[0].meta.password_set_at, null);
});

Deno.test("不能替 patient 帳號重設研究人員初始密碼", async () => {
  const { deps, applied } = makeDeps({
    getUserById: () => Promise.resolve({
      user: { ...staffUser, app_metadata: { role: "patient" } },
      error: null,
    }),
  });

  const result = await resetResearcherInitialPassword("patient-1", "pi-1", "temp-pass-1234", NOW, deps);

  assert.equal(result.status, 403);
  assert.deepEqual(applied, []);
});

Deno.test("太短的初始密碼在打到 Supabase 前就擋下", async () => {
  const { deps, applied } = makeDeps();

  const result = await resetResearcherInitialPassword("researcher-1", "pi-1", "short", NOW, deps);

  assert.equal(result.status, 400);
  assert.deepEqual(applied, []);
});

Deno.test("Supabase 判定密碼太弱時說清楚是密碼的問題", async () => {
  const { deps } = makeDeps({
    applyInitialPassword: () => Promise.resolve({
      error: { code: "weak_password", message: "Password is too weak" },
    }),
  });

  const result = await resetResearcherInitialPassword("researcher-1", "pi-1", "password1234", NOW, deps);

  assert.equal(result.status, 400);
  assert.match(result.body.error ?? "", /密碼/);
});
