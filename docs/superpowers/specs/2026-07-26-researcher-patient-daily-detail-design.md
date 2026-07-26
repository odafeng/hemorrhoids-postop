# 研究者：病人逐日回報明細 + 疼痛趨勢

**日期**：2026-07-26
**狀態**：設計待實作
**背景需求**：研究者畫面目前只看得到匯總（cohort 每列只有平均疼痛與遵從率），
無法看到「某位病人每一天的回報結果」，也看不出疼痛趨勢是否下降。

## 目標

研究者能從概覽點進任一位病人，看到該病人的：
1. 疼痛 NRS 趨勢圖（判讀是否逐日下降）。
2. 逐日回報明細（唯讀 timeline）。

## 非目標（YAGNI）

- 不做每位病人獨立的新頁面元件；病人詳情沿用「查詢」頁同一套實作。
- 不加出血/排便等其他症狀的趨勢圖（只做疼痛趨勢，其餘看逐日明細即可）。
- 不加研究者對回報的編輯功能（唯讀）。
- 不改動任何後端／資料層查詢。

## 資料來源（已存在，無需新增）

`ResearcherPatientLookup` 查詢時已呼叫 `sb.getAllReports(studyId)`，回傳該病人
**全部逐日原始列**，欄位：`report_date`、`pod`、`pain_nrs`、`bleeding`、`bowel`、
`fever`、`wound`、`urinary`、`continence`、`report_source`（`report_date` 為
descending 排序）。目前只用來算 `totalReports` 與最新一筆，其餘丟棄。改為保留整份
陣列渲染。

## 元件與改動

> **決策（2026-07-26 定案）**：疼痛趨勢圖由研究者頁**自帶一份 inline SVG**，
> **不**抽共用元件、**不**動病人面向的 `History.jsx`。收案期間 blast radius 最小；
> 代價是與 History 的趨勢圖有約 40 行重複，接受。

### 1. `pages/ResearcherPatientLookup.jsx`（改動）
- 查詢成功後，把整份 `reports` 陣列存進 `result`。
- 在「CASE DETAIL」卡下方新增兩段：
  - **疼痛趨勢**：頁內自帶一份 SVG 折線圖（改寫自 `History.jsx` 的趨勢圖，
    不共用）。x 軸 POD（無手術日時退回日期）、y 軸 NRS 0–10；點依
    `<4 綠 / 4–6 黃 / ≥7 紅` 上色；提供 7D / 14D / ALL 切換。餵入原始列的
    `pain_nrs` / `report_date` / `pod`。
  - **逐日明細**：沿用 `History.jsx` 每日症狀卡片樣式（POD 標籤 + 疼痛/出血/排便/
    發燒/傷口/排尿/肛門控制，依嚴重度上色），**唯讀、不放修改鈕**。傷口顯示沿用
    `schemaContract` 的 `isWoundNormal` / `formatWound`。
- **空狀態**：病人已建檔但 0 筆回報 → 「尚無回報紀錄」。
- **路由參數自動載入**：支援 `useParams()` 的 `studyId`；若存在則於掛載時自動執行
  查詢（等同使用者輸入該編號按查詢）。保留原本手動輸入查詢入口。

### 2. `App.jsx`（改動）
新增路由 `/lookup/:studyId`，指向同一個 `ResearcherPatientLookup`。既有 `/lookup`
（手動查詢）保留。

### 3. `pages/ResearcherDashboard.jsx`（改動）
cohort 每一列可點 → `navigate('/lookup/' + row.study_id)`。
- 該列已有「撰寫手術紀錄」按鈕：需 `stopPropagation`，避免點按鈕時誤觸整列導覽。
- 列本身以可鍵盤操作方式呈現（`role="button"` + Enter/Space，或包成 `<button>`），
  維持無障礙。

## 測試

- 新增 `pages/__tests__/ResearcherPatientLookup.test.jsx`：
  - mock `sb.getAllReports` 回傳兩筆逐日資料 → 查詢後驗證逐日明細渲染出 POD 標籤與
    疼痛值、且趨勢圖有渲染（存在對應 SVG / testid）。
  - 0 筆 → 顯示「尚無回報紀錄」。
- 視需要補一則 `ResearcherDashboard` 列可點導覽的測試。

## 部署與風險

- 純前端變更 → 需**一次前端部署**（Vercel）。依 [[no-deploy-during-enrolment]]，
  排傍晚/深夜；部署後病人端會看到「系統已更新」橫幅，以 test 帳號驗證。
- 改動範圍全在研究者面向頁面（`ResearcherPatientLookup` / `ResearcherDashboard` /
  `App.jsx` 路由）；**不觸碰病人面向的 `History.jsx`**，收案期間 blast radius 最小。

## 已定案決策

1. 疼痛趨勢圖 → 研究者頁自帶一份 inline SVG，不抽共用、不碰 `History.jsx`。
   接受與 History 趨勢圖約 40 行重複，換取收案期間最小風險。
