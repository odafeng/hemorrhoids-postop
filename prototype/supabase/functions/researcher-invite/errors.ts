type InviteError = { status?: number; code?: string; message?: string };

export function invitationErrorResponse(error: InviteError, email: string) {
  if (
    error.code === "email_exists" ||
    /already registered|already been registered|already exists/i.test(error.message || "")
  ) {
    return { status: 409, error: `${email} 已經註冊過` };
  }
  if (error.code === "email_address_not_authorized") {
    return { status: 503, error: "尚未設定 Custom SMTP，無法寄送到外部信箱" };
  }
  if (error.code === "over_email_send_rate_limit") {
    return { status: 429, error: "寄信次數過多，請稍後再試" };
  }
  return null;
}
