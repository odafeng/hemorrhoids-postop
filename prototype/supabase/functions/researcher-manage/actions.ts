type StaffUser = {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
};

type AuthError = { code?: string; message?: string };

export type ResendActivationDeps = {
  getUserById: (userId: string) => Promise<{ user: StaffUser | null; error: AuthError | null }>;
  sendRecoveryEmail: (email: string) => Promise<{ error: AuthError | null }>;
  writeAudit: (detail: Record<string, unknown>) => Promise<void>;
};

type ActionResult = { status: number; body: { success?: boolean; error?: string } };

export async function resendResearcherActivation(
  targetId: string,
  actorId: string,
  deps: ResendActivationDeps,
): Promise<ActionResult> {
  if (!targetId) return { status: 400, body: { error: "缺少 user_id" } };

  const { user, error: fetchError } = await deps.getUserById(targetId);
  if (fetchError || !user) return { status: 404, body: { error: "找不到指定使用者" } };

  const role = user.app_metadata?.role;
  if (role !== "researcher" && role !== "pi") {
    return { status: 403, body: { error: "此操作僅限研究員或主持人帳號" } };
  }
  if (!user.email) return { status: 400, body: { error: "此帳號沒有 Email" } };

  const { error: sendError } = await deps.sendRecoveryEmail(user.email);
  if (sendError?.code === "email_address_not_authorized") {
    return { status: 503, body: { error: "尚未設定 Custom SMTP，無法寄送到外部信箱" } };
  }
  if (sendError?.code === "over_email_send_rate_limit") {
    return { status: 429, body: { error: "寄信次數過多，請稍後再試" } };
  }
  if (sendError) throw new Error(sendError.message || "寄送失敗");

  await deps.writeAudit({
    actor_id: actorId,
    target_id: user.id,
    target_email: user.email,
  });
  return { status: 200, body: { success: true } };
}
