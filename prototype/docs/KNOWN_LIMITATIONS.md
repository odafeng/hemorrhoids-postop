# 已知限制與技術決策

## iOS 推播通知

**限制**：iOS Safari 僅在 iOS 16.4+ 且 PWA 模式下（加入主畫面後）支援 Web Push。

**對策**：
1. `IOSInstallPrompt` 元件引導 iOS 用戶「加入主畫面」
2. PWA manifest 已配置完整
3. Web Push 已實作（VAPID + RFC 8291），PWA 模式下可正常推播
4. Server-driven `check-adherence` cron 每日產生 `pending_notifications`，App 開啟時自動讀取（雙層保障）
5. Client-side scheduler 在 App 開啟時作為備用提醒

**影響**：
- 收案時需要在知情同意書中說明此限制
- 建議在 Onboarding 流程中協助病人加入主畫面
- 非 PWA 模式的 iOS 使用者只能靠 pending_notifications 在開啟 App 時看到提醒

---

## 邀請碼驗證

**機制**：兩層驗證
1. Per-patient token：`study_invites` table（未來正式收案用）
2. Global fallback：`GLOBAL_INVITE_TOKEN` env var（預設 `HEMORRHOID2026`）

**注意**：正式收案前建議將 `GLOBAL_INVITE_TOKEN` 設成只有研究團隊知道的值，或改用 per-patient token。

---

## 密碼重設

已實作 Supabase `resetPasswordForEmail()`。重設連結會寄到病人信箱，點擊後導回 App。需在 Supabase Dashboard → Authentication → URL Configuration 設定 redirect URL。

---

## System Prompt 維護

**架構**：
- 唯一來源：`shared/system-prompt.json`
- 同步機制：`npm run sync-prompt` → 自動產生 `supabase/functions/ai-chat/_prompt.ts`
- CI 中 `predeploy` script 自動執行同步

**更新流程**：
1. 修改 `shared/system-prompt.json`
2. 執行 `npm run sync-prompt`（或部署時自動同步）
3. 重新部署 Edge Function：`supabase functions deploy ai-chat`

---

## Researcher 帳號建立

目前沒有自助 Researcher 註冊流程。Researcher/PI 帳號需要：
1. 在 Supabase Dashboard → Authentication → Users 手動建立
2. 設定 `user_metadata.role = 'researcher'` 或 `'pi'`

---

## Rate Limiting

Edge Function 的 rate limiting 是 per-instance in-memory（20 req/min per IP）。
Supabase Edge Functions 可能在多個 instance 上運行，限制不是全域的。
對 100 人規模研究足夠，若需更嚴格可升級為 Redis-based。

---

## PII 對照表

`pii_patients` 表需手動由研究者在 Supabase SQL Editor 執行 INSERT（使用 `pgp_sym_encrypt`）。
目前無 UI 介面管理 PII 對照。此為 IRB 設計決策：降低 PII 洩露風險。

---

## Alert 引擎

Alert 由 PostgreSQL trigger (`fn_check_alerts`) server-side 產生，INSERT 和 UPDATE 均會觸發。Client-side `checkAlerts()` 僅用於 Demo mode。

已知行為：修改回報從「異常→正常」時，**已產生的 alert 不會自動撤回**。研究者需手動 acknowledge。

---

## Dark / Light Mode

Light mode 為 CSS variable override (`[data-theme="light"]`)。部分 component 的 inline style 可能仍有 dark-mode 假設的半透明白色值（如 `rgba(255,255,255,0.x)`），在 light mode 下可能不夠明顯。

---

## 離線行為

PWA 為 network-first 策略。離線時：
- 可瀏覽已快取的頁面
- 無法使用 AI 衛教（需即時呼叫 Edge Function）
- 症狀回報**會存入離線 queue**（`src/utils/offlineQueue.js`，localStorage），
  `OfflineBanner` 顯示待送出筆數，恢復連線後由 `App.jsx` 的 `flushQueue()` 自動補送

## PWA 更新行為

新版部署後，Service Worker 會立即 activate，但**不會自動 reload 頁面** —
避免病人填到一半的症狀回報被清空。改由 `UpdateBanner` 顯示「系統已更新／重新載入」，
由使用者自行決定何時套用。代價是使用者在按下重新載入前，仍執行舊版 bundle。
