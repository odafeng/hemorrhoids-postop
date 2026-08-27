# 0001. 追蹤期於 POD 30 由伺服器端自動結案

日期：2026-08-28

## 狀態

已接受。實作分層進行，本則涵蓋整個 close-out 機制的決策。

## 背景

每位受試者追蹤 30 天。POD 30 是觀察窗的終點，但它不在 `fn_report_days()` 裡——
回報排程最後一天是 POD 27。所以病人端在 POD 30 那天不會收到推播，Dashboard 也不會
掛出任何卡片。

`patients.study_status` 的寫入端全 codebase 只有一處：`patient-onboard/index.ts`
在註冊時寫死 `'active'`。沒有任何地方寫 `'completed'`，`completed_at` 欄位從未被寫過。
兩個分析 view 濾的是 `<> 'withdrawn'`，而 `'withdrawn'` 同樣沒有寫入端。

所以追蹤期結束時沒有任何一端會發出訊號。HSF-001 在 2026-08-23 到達 POD 30，
五天後查對照表才發現它還是 `active`。

排程基礎設施方面：production 沒有安裝 pg_cron，現有的 `check-adherence` 由
`.github/workflows/cron-notify.yml` 以 GitHub Actions 每日兩次觸發。

## 決策

滿 30 天即結案，由伺服器端自動執行，不依賴任何人記得按按鈕。

- 規則寫在 `supabase/functions/_shared/followup.ts`，單一定義。`podFor()` 自
  `check-adherence/schedule.ts` 上移至此，兩個 function 共用同一份。
- 執行者為獨立的 Edge Function `close-followup`，由 GitHub Actions 觸發，
  沿用 `check-adherence` 既有的 `CRON_SECRET` 模式。
- `completed_at` 寫入手術日 + 30 天，不是執行時刻。理由與 `pii_patients.enrolled_at`
  相同：記錄真實事件時間，補登時刻沒有研究意義。
- 冪等。已是 `completed` 或 `withdrawn` 的列不再處理，重跑無副作用。
- 不新增任何 DDL。`study_status` 目前是無 CHECK constraint 的 VARCHAR(20)，
  寫入 `'completed'` 不需要 migration。

## 後果

追蹤期結束第一次有了明確訊號。`check-adherence` 會自動略過已結案者，每日 ntfy
摘要的逾期清單會自己清空。分析不受影響：兩個 view 濾的是 `'withdrawn'`，
`'completed'` 仍在結果集內（已於 HSF-001 結案後實測確認）。

代價與已知缺點：

- 多了一個會自動寫 production 資料的排程。在此之前只有 `check-adherence` 會寫
  `pending_notifications`。收案期間新增自動寫入端有風險，所以函式與排程拆成
  兩層合併，中間留一次人工實測。
- `study_status` 仍然是自由字串。沒有 CHECK constraint 保證拼寫，打錯字會靜默地
  讓病人從 `'active'` 集合掉出去。收緊成 CHECK 或 enum 是 DDL，收案期間不做。
- 沒有手動覆寫。提前結案、退出（withdrawn）與重開都不在本次範圍。規則既然是無條件的，
  加一個手動入口等於把「要有人記得」放回流程；退出屬於 IRB 層次的概念，
  與「滿 30 天」不是同一件事。
- 前端規則是鏡像而不是共用。Vite 端無法 import Deno 模組，`src/utils/followup.js`
  只能靠測試釘住數值一致，沿用 `fn_report_days()` 既有的做法。鏡像會漂移，
  擋得住的只有那個測試。
