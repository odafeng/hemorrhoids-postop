# CRF 自動填寫：以 DB 匯出為準

日期：2026-08-29
狀態：設計已核可，待實作

## 問題

`收案文件/個案報告表_CRF紀錄.xlsx` 從 2026-07-23 收案至今幾乎沒有跟上。11 例受試者中，
`表單一_收案登記` 只有 1 列、`個案總覽` 只有 1 列、`表單二_每日症狀回報` 只有 8 列
（同一例在 DB 裡實際有 13 筆）、`表單六_結案退出` 完全空白，即使已有一例在 2026-08-22 結案。

同一批資料在 Supabase 裡是完整的。落差不是資料沒收到，是沒有人把它抄進 CRF。

PI 已決定：**DB 是 source of truth，CRF 只承載 DB 生不出來的欄位。**

## 這個決定暴露的三個洞

「以 DB 匯出為準」預設 DB 裝得下 CRF 的每個欄位。實際查過並非如此：

| CRF 欄位 | DB 現況 | 處置 |
|---|---|---|
| 表單一：年齡、性別、BMI | `patients` 有欄位，11 例全 NULL，全 codebase 無寫入端（`bmi` 只命中 `submit` 的子字串）。`v_adherence_summary` 還 select 了這三欄，等於又一個讀死欄位的下游 | PI 決定收案結束後回溯補登。本次維持手填 |
| 表單四：醫療利用 | 表、RLS policy、`getUtilization()` 都在，但沒有 insert 端，讀取函式零呼叫端 | 本次補最小 insert 路徑（免 DDL） |
| 表單三：處理方式／處理結果／是否為假陽性／處理人員 | `alerts` 只有 `acknowledged`、`acknowledged_at`、`acknowledged_by`，這四欄不存在 | 加欄位屬 DDL，收案期間禁止。維持手填，判讀理由寫 `資料澄清註記` 分頁 |

## 欄位權責邊界

`A` 由腳本每次覆寫，`M` 腳本永不觸碰。

| 表單 | A（自動） | M（手填） |
|---|---|---|
| 個案總覽 | 序號、Study ID、主刀醫師、手術／收案日期、實際回報數、應回報數、AI 使用次數、警示總數、未確認警示、可用性問卷、收案狀態 | 備註 |
| 表單一 收案登記 | 收案日期、痔瘡分級、手術日期、術式、縫合方式、能量器械、麻醉方式、主刀醫師、同意書簽署日、App 註冊完成 | 年齡、性別、BMI、納入條件、排除條件、補助費簽收、研究人員簽名、備註 |
| 表單二 每日症狀回報 | 其餘 11 欄 | 備註 |
| 表單三 警示處理 | 警示日期、POD、類型、等級 | 處理方式、處理結果、是否為假陽性、處理人員、處理日期 |
| 表單四 醫療利用 | 就醫日期、POD、就醫類型、就醫原因 | 記錄人員 |
| 表單六 結案退出 | Study ID、結案狀態、結案日期、POD、總回報次數、預期次數、依從率、AI 次數、可用性問卷 | 退出原因、備註、研究人員簽名 |
| 資料澄清註記 | 無 | 全部 |

三個規則：

- `POD（今日）` 與 `依從率` 保留既有 Excel 公式，腳本不寫這兩欄。覆寫成靜態值會讓工作簿失去自動更新。
- 「App 註冊完成」以「`patients` 有這一列」判定，不讀 `patients.app_activated`，那是死欄位，11 例全 `false`。
- 應回報數與依從率一律取 `v_adherence_summary`，不在腳本裡重算。回報日規則的單一定義在
  `fn_report_days()`（POD 0–7 每天、9/11/13、20/27，共 13 天），前端 `isReportDay()` 是它的鏡像。
  腳本再寫第三份就會出現三方不一致。

## 架構

資料只走一條路。腳本不連 Supabase，吃的是研究人員 Dashboard 既有的「完整備份」JSON。

```
ResearcherDashboard「完整備份」 ──► full_backup_YYYY-MM-DD.json ──► crf_fill.py ──► CRF 工作簿
        (既有功能，本次擴充)              (~/Downloads)              (新增)         (就地更新)
```

### (a) 擴充既有備份

`ResearcherDashboard.jsx` 的 `handleFullBackup` 目前收 4 張表（`patients`、`symptom_reports`、
`alerts`、`ai_chat_logs`），缺 CRF 需要的四份：

| 來源 | CRF 用途 | 現況 |
|---|---|---|
| `surgical_records` | 表單一的術式、分級、麻醉、能量器械 | RLS 齊全，缺 `getAll…ForResearcher()` |
| `usability_surveys` | 個案總覽與表單六的可用性問卷 | `researcher_read_surveys` 已存在，缺函式 |
| `healthcare_utilization` | 表單四 | `getUtilization()` 已寫好，零呼叫端 |
| `v_adherence_summary` | 應回報數、依從率 | `getAdherenceSummary()` 已存在，備份沒收 |

照 `getAllAlertsForResearcher()` 的樣式補三個讀取函式，`Promise.all` 從 4 個擴到 8 個（`getAdherenceSummary()` 已存在，直接接上）。

### (b) crf_fill.py

`prototype/scripts/crf_fill.py`，Python + openpyxl，沿用 `scripts/` 既有慣例。輸入預設取
`~/Downloads/` 裡最新一份 `full_backup_*.json`，可用位置參數覆寫。不連 DB，也不需要金鑰。

寫入規則：

- 對位鍵不是列號。個案總覽、表單一、表單六以 `study_id` 對位；表單二以
  `(study_id, report_date)`；表單三以 `(study_id, triggered_at)`；表單四以 `(study_id, event_date)`。
  列序會因新資料而重排，靠列號對位會把手填備註接到別人身上。
- 新列補樣式：設完 `.value` 要 `copy()` 前一列的 `_style`，否則新列停在空白列的「待填」樣式。
  只設 font 會漏掉 alignment / border / fill。此坑見 `研究日誌/2026-08-13.yaml`。
- 下拉清單範圍：對照表的 `dv.sqref` 只涵蓋第 6–55 列；CRF 各分頁若有同類設定，超出範圍要一併調整。
- 每次先備份成 `個案報告表_CRF紀錄.bak-YYYYMMDD.xlsx`。檔名沿用 `.gitignore:40` 的
  glob `收案文件/個案報告表*.xlsx`，自動不進版控。

## 錯誤處理

`surgical_records` 的 researcher policy 是 `researcher_read_own_surgeon`，只看得到自己的刀；
只有 PI 的 `pi_manage_surgical` 是 FOR ALL。非 PI 帳號下載的備份會少列，而少的那幾列
在 CRF 裡看起來就只是空白。

所以腳本啟動時先驗證涵蓋率：備份裡 `surgical_records` 的 `study_id` 集合若不包含
`patients` 的全部（`TEST-` 開頭除外），直接中止並列出缺哪幾例，不寫檔。

這條規則同時抓得到另一種情形：某例真的沒有手術記錄。目前 FIH-003 就是如此，
其餘 10 例都有。這種缺漏要浮出來，不能靜默留白。

## 測試

`prototype/scripts/test_crf_fill.py`，沿用 `test_dashboard.py` 的 unittest 慣例
（該檔同樣不在 CI，需手動 `python3 -m unittest discover -s scripts -p 'test_*.py'`）。

以合成 JSON 與一份最小工作簿 fixture 驗證：

1. 手填欄在重跑後原值不變，包含新資料插入導致列序改變的情況
2. 對位鍵正確：同一 `study_id` 的兩筆不同日期回報不會互相覆蓋
3. 公式欄（`POD（今日）`、`依從率`）重跑後仍是公式，不是靜態值
4. `surgical_records` 涵蓋率不足時中止且不寫檔
5. 新列的 `_style` 與前一列一致

前端側，三個新讀取函式沿用既有 Vitest 測試樣式。

## 範圍外

- 年齡、性別、BMI 的回溯補登。PI 決定收案結束後處理
- `alerts` 增加處理欄位。屬 DDL，收案期間不做
- 把 CRF 填寫接進每日排程。先手動執行，穩定後再談
- `v_adherence_summary` 那三個死欄位（`age`、`sex`、`surgery_type`）的清理。屬獨立的死欄位盤點任務
- FIH-003 缺少的手術記錄。要由主刀醫師從 App 補登，不是腳本能生的
