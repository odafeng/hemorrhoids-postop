type ProvisionError = { status?: number; code?: string; message?: string };

// Accounts are created with a PI-supplied password rather than an emailed
// invite link, so nothing here sends mail — the SMTP and send-rate branches
// this module used to carry can no longer fire.
export function invitationErrorResponse(error: ProvisionError, email: string) {
  if (
    error.code === "email_exists" ||
    /already registered|already been registered|already exists/i.test(error.message || "")
  ) {
    return { status: 409, error: `${email} 已經註冊過` };
  }
  if (error.code === "weak_password") {
    return { status: 400, error: "初始密碼不符合安全性要求，請換一組" };
  }
  return null;
}
