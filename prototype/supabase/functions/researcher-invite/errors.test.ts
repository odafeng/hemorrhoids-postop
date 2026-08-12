import assert from "node:assert/strict";
import { invitationErrorResponse } from "./errors.ts";

Deno.test("只有 email_exists 才顯示已註冊", () => {
  assert.deepEqual(
    invitationErrorResponse({ code: "email_exists", message: "already exists" }, "staff@example.com"),
    { status: 409, error: "staff@example.com 已經註冊過" },
  );
});

// The PI types the initial password, so they are the one who has to be told it
// was rejected — an untranslated GoTrue code reads as "建立失敗" and they retry
// the same password.
Deno.test("初始密碼被強度檢查擋下時說清楚是密碼的問題", () => {
  assert.deepEqual(
    invitationErrorResponse({ code: "weak_password", message: "Password is too weak" }, "staff@example.com"),
    { status: 400, error: "初始密碼不符合安全性要求，請換一組" },
  );
});

Deno.test("不把未知 422 誤報成重複帳號", () => {
  assert.equal(
    invitationErrorResponse({ status: 422, code: "unexpected", message: "other validation" }, "staff@example.com"),
    null,
  );
});
