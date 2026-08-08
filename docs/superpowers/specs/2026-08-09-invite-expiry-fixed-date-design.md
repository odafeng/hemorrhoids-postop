# 邀請碼有效期改為固定到期日

**日期**：2026-08-09
**狀態**：設計已核准，待實作。

**背景**：2026-08-08 依 PI 指示，將 production `study_invites` 全部 12 筆的 `expires_at`
改為 2027-12-31 23:59:59+08（見研究日誌 2026-08-08）。但那只動資料，`createStudyInvite()`
的預設有效期仍是建立後 30 天，日後從研究人員後台新開的邀請碼不受涵蓋，會再度長出一批
到期日不一致的碼。本設計處理程式碼這一側。

## 問題

現行模型是「建立後 N 天」，帶來幾個實際後果：

1. **同一研究長出多批不一致的到期日。** HSF-001～010 於 2026-07-23 以 90 天預先產生，
   到期 2026-10-21；WCC-001/002 於 2026-08-04 從後台開立，套用 30 天預設，到期 2026-09-03。
   兩批相差近七週，而差異純粹來自「哪天開的、走哪條路徑」，與研究本身無關。
2. **UI 上限擋住了正確答案。** 「有效天數」輸入框寫死 `max="365"`，而從 2026-08 到
   2027-12-31 是 510 天。在天數模型下，研究人員根本無法表達研究實際需要的有效期。
3. **這個欄位不該存在。** 研究人員在收案當下要決定的是開哪一個 study_id，不是這張碼
   該活多久。有效期是研究層級的參數，不是逐案決策，把它放在收案動線上只是多一個
   可以填錯的地方。

## 目標

1. 新開的邀請碼與 2026-08-08 已更新的 12 筆到期日一致。
2. 有效期成為單一來源的常數，收案延長時只改一處。
3. 研究人員收案動線上不再出現有效期欄位。

## 非目標（YAGNI）

- 不動已存在的 12 筆（2026-08-08 已處理完畢）。
- 不動 `patient-onboard` 的驗證邏輯（`status='pending'` 且 `expires_at >= now()` 維持不變）。
- 無 schema 變更、無 migration。
- 不保留 per-invite 的有效期覆寫參數。目前沒有呼叫端需要它，留著就是留一個沒人走的分支。
- 不處理「碼提前作廢」的需求，`status` 已有 `revoked` 值在做這件事。

## 關鍵決策

### 一、固定到期日，而非拉長天數

天數模型即使把預設改成 510、上限放寬到 800，仍然是「建立後 N 天」：2027 年才開的碼會
活到 2029 年，而且預設值每天都在變。固定到期日直接對應研究實際需要的語意：這張碼有效到
收案結束為止，跟它哪天開的無關。

### 二、日期只是緩衝值，不是 IRB 里程碑

經與 PI 確認，2027-12-31 **不對應** IRB 核准的任何日期，只是刻意設遠、足以撐過收案期的
緩衝。常數註解必須寫明這一點，否則日後維護者會誤以為那是法規期限而不敢改，或反過來
以為改了它就等於延長了 IRB 許可。

### 三、常數必須是當日日終

`patient-onboard` 的驗證條件是 `expires_at >= now()`。若常數寫成 `'2027-12-31'`
（解析為 UTC 午夜，即台北時間當日早上 8 點），研究人員與 PI 認知中的「有效到 12/31」
實際上在該日早上 8 點就結束了。同一類錯誤在 2026-08-08 更新 production 資料時已經
出現過一次，故常數固定寫成帶時區的日終形式，並以測試釘死。

## 元件與改動

### 1. `prototype/src/utils/supabaseService.js`

新增匯出常數：

```js
// 邀請碼一律到此日期失效，而非「建立後 N 天」，所以先後發出的碼有效期一致。
// 此日期並非 IRB 里程碑，只是刻意設遠、足以撐過收案期的緩衝值；收案延長就改這行。
// 必須是當日日終：patient-onboard 的驗證條件為 `expires_at >= now()`，寫成日期起點
// 會讓標稱的最後一天整天失效。
export const INVITE_EXPIRY_DATE = '2027-12-31T23:59:59+08:00';
```

`createStudyInvite(studyId, expiresInDays = 30)` 改為 `createStudyInvite(studyId)`。
函式內移除 `expires` 的天數計算，insert 與 update 兩條路徑都寫入
`new Date(INVITE_EXPIRY_DATE).toISOString()`。JSDoc 的 `@param expiresInDays` 一併移除。

### 2. `prototype/src/pages/ResearcherDashboard.jsx`

- 移除 `inviteDays` state。
- 移除「有效天數」`input-group`。
- 呼叫改為 `sb.createStudyInvite(studyId)`，一併移除 `Number(inviteDays) || 30` fallback。
- **保留**建立成功後顯示的「到期：」。研究人員不需要設定它，但需要看得到自己剛開的碼
  什麼時候失效。

### 3. `prototype/src/utils/__tests__/inviteExpiry.test.js`（新增）

沿用 `ensurePatient.test.js` 既有的 `vi.hoisted` + `vi.mock('../supabaseClient')` 模式，
攔截 supabase client 並斷言送出的 payload：

- 新建路徑（無既有列）：`insert()` 的 `expires_at` 等於 `2027-12-31T15:59:59.000Z`。
- 重新產生路徑（既有 `pending` 列）：`update()` 的 `expires_at` 為同一值。
- 常數本身解析後等於台北時間當日日終，而非日始。這條是回歸測試，針對「決策三」所述、
  已經發生過一次的錯誤類別。

## 測試與驗證

| 步驟 | 驗證方式 |
|------|----------|
| 新測試先紅 | 在改動 `supabaseService.js` 前執行，斷言 `expires_at` 應失敗 |
| 實作後轉綠 | `npx vitest run src/utils/__tests__/inviteExpiry.test.js` |
| 未破壞既有測試 | `npx vitest run`（含 `schemaAlignment.test.js`，其僅讀取 migration 文字，預期不受影響） |
| Lint 與建置 | `npm run lint` 與 `npm run build` |
| Production 冒煙 | 部署後於後台開立一組測試 study_id，確認顯示之到期日為 2027-12-31，隨後撤銷 |

## 部署影響

純前端改動，不涉及 Edge Function 邏輯與資料庫。但 push 到 main 會觸發 `ci.yml` 的
`deploy-supabase`（重新部署全部 Edge Function，來源不變）與 Vercel 重建；後者可能讓
當下開著 App 的受試者看到「系統已更新」橫幅。依既有慣例安排在夜間收案空檔。

## 回退

回退 commit 並重新部署即可，不需要碰資料庫。已發出的邀請碼其 `expires_at` 已寫入
資料列，不隨程式碼版本改變。
