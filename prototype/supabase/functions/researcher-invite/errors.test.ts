import assert from "node:assert/strict";
import { invitationErrorResponse } from "./errors.ts";

Deno.test("只有 email_exists 才顯示已註冊", () => {
  assert.deepEqual(
    invitationErrorResponse({ code: "email_exists", message: "already exists" }, "staff@example.com"),
    { status: 409, error: "staff@example.com 已經註冊過" },
  );
});

Deno.test("外部信箱被 default SMTP 拒絕時提示設定 Custom SMTP", () => {
  assert.deepEqual(
    invitationErrorResponse({ code: "email_address_not_authorized", message: "not authorized" }, "staff@example.com"),
    { status: 503, error: "尚未設定 Custom SMTP，無法寄送到外部信箱" },
  );
});

Deno.test("不把未知 422 誤報成重複帳號", () => {
  assert.equal(
    invitationErrorResponse({ status: 422, code: "unexpected", message: "other validation" }, "staff@example.com"),
    null,
  );
});
