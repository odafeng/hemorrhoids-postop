type StaffUser = {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};

type AuthError = { code?: string; message?: string };

export type ResetInitialPasswordDeps = {
  getUserById: (userId: string) => Promise<{ user: StaffUser | null; error: AuthError | null }>;
  applyInitialPassword: (
    userId: string,
    password: string,
    userMetadata: Record<string, unknown>,
  ) => Promise<{ error: AuthError | null }>;
  writeAudit: (detail: Record<string, unknown>) => Promise<void>;
};

type ActionResult = { status: number; body: { success?: boolean; error?: string } };

/**
 * PI hands a locked-out staff member a fresh initial password, face to face.
 *
 * This replaces an earlier action that emailed a recovery link. That link is the
 * one thing known not to work — the recovery mail reaches the inbox carrying an
 * empty href — so the only repair tool the PI had was the broken path itself.
 */
export async function resetResearcherInitialPassword(
  targetId: string,
  actorId: string,
  newPassword: string,
  nowIso: string,
  deps: ResetInitialPasswordDeps,
): Promise<ActionResult> {
  if (!targetId) return { status: 400, body: { error: "缺少 user_id" } };
  if (!newPassword || newPassword.length < 8) {
    return { status: 400, body: { error: "初始密碼至少需要 8 個字元" } };
  }

  const { user, error: fetchError } = await deps.getUserById(targetId);
  if (fetchError || !user) return { status: 404, body: { error: "找不到指定使用者" } };

  const role = user.app_metadata?.role;
  if (role !== "researcher" && role !== "pi") {
    return { status: 403, body: { error: "此操作僅限研究員或主持人帳號" } };
  }

  // Re-arm the first-login change. useAuth shows the set-password screen while
  // invited_at is present and password_set_at is not, so clearing the latter is
  // what makes the researcher replace a password the PI has just seen. Accounts
  // that predate invited_at get one stamped now, or nothing would trigger.
  const existingMeta = user.user_metadata || {};
  const { error: applyError } = await deps.applyInitialPassword(user.id, newPassword, {
    ...existingMeta,
    invited_at: existingMeta.invited_at || nowIso,
    password_set_at: null,
  });
  if (applyError?.code === "weak_password") {
    return { status: 400, body: { error: "初始密碼不符合安全性要求，請換一組" } };
  }
  if (applyError) throw new Error(applyError.message || "重設失敗");

  await deps.writeAudit({
    actor_id: actorId,
    target_id: user.id,
    target_email: user.email,
  });
  return { status: 200, body: { success: true } };
}
