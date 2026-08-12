# Primary outcome 的量測缺口與待定義事項

2026-08-12 · 收案第 21 天 · 已收 5 例（另有 TEST-001 測試帳號）

追查一個提醒排程的 bug 時，順著依從率的算法查下去，發現 primary outcome 的三個構成指標裡有兩個目前量不準。原始資料完整，兩個問題都能事後重建，不需要改 production。但有三件事需要在分析前定義清楚，現在寫比事後回想準確。

## Protocol 怎麼定的

計畫書 ver2 第六節：

> 主要結局指標（Primary Outcome）：系統可行性（feasibility），包含：App 啟用率、問卷填寫率（adherence rate）、術後第 0-7 天內完成 ≥ 5 次回報之比例

3.3 節的可行性門檻：

| 指標 | 門檻 |
|---|---|
| App 啟用率 | ≥ 80% |
| 問卷整體完成率（adherence rate） | ≥ 70% |
| 術後第 0-7 天內至少完成 5 次回報之比例 | ≥ 70% |

研究設計是前瞻性單中心先導可行性研究（pilot feasibility study），50 例。

## 三個指標的現況

| 構成 | 目前數值 | 狀態 |
|---|---|---|
| App 啟用率 | 100%（曾登入）或 80%（曾回報） | `app_activated` 欄位從未被寫入，且「啟用」無操作型定義 |
| 問卷填寫率 adherence | 儀表板顯示 HSF-001 為 100%，實際回報日依從率 81.8% | 分子分母不對稱 |
| POD 0-7 完成 ≥5 次之比例 | 3/3 = 100%（僅計已滿 7 天者） | 目前唯一沒有量測問題的指標 |

## 缺口一：`app_activated` 從未被寫入，且「啟用」沒有定義

`patients.app_activated`（BOOLEAN NOT NULL DEFAULT FALSE）與 `app_activated_at` 在 `base_schema.sql:120-121` 宣告，但整個 codebase 沒有任何一處寫入這兩個欄位。六筆病人資料全部是 `false` / `null`，包含已完成 11 次回報的 HSF-001。

照這個欄位計算，App 啟用率會是 0%。

更根本的問題是，protocol 沒有寫「啟用」的操作型定義。可能的讀法至少四種，對應的數字不同：

| 讀法 | 目前值 | 資料來源 | 備註 |
|---|---|---|---|
| 研究人員建立帳號 | 5/5 | `patients.created_at` | 反映的是研究人員的動作，不是病人行為 |
| 病人首次登入 | 5/5 | `auth.users.last_sign_in_at` | 可事後重建 |
| 病人首次完成回報 | 4/5 | `min(symptom_reports.report_date)` | 與 adherence 高度重疊 |
| 加入主畫面（PWA 安裝） | 無紀錄 | — | 最貼近字面意思，系統未量測 |

第四種在本研究不只是定義問題。iOS 上 PWA 未加入主畫面就無法接收推播通知，`IOSInstallPrompt.jsx` 即為此而存在。若有受試者未完成安裝，其低依從率反映的是收不到提醒，而非不願填寫。可行性研究最需要區分的正是這兩件事，目前區分不了。

欄位宣告為 `NOT NULL DEFAULT FALSE`，於是它永遠有值且永遠是 false，看不出從未被寫入。若宣告為 nullable，全數為 null 會立刻暴露問題。預設值把「沒有資料」記成了「否」。

### 待決定

「啟用」採用哪一個定義。差異落在 FIH-001 一例（2026-08-12 建帳號並登入，隔日手術，尚未回報），會影響分母與門檻判定。

## 缺口二：adherence 的分子與分母不對稱

`v_adherence_summary` 的算法：

- 分母 `fn_expected_reports(POD)`：只計回報日（POD 0-7、9、11、13、20、27，30 天內共 13 天）
- 分子 `count(sr.id)`：計入全部回報，不分是否為回報日

落在非回報日的回報會灌入分子而分母不變，使依從率虛高。算式外層還包了 `LEAST(100, ...)`，溢出的部分會被截掉，所以儀表板上看到的是剛好 100%，不是一個明顯不合理的數字。

目前唯一受影響的是 HSF-001：

| 項目 | 值 |
|---|---|
| 實際回報 POD | 0, 1, 2, 4, 5, 6, 7, 9, 11, 14, 16 |
| 排程回報日（≤19） | 0, 1, 2, 3, 4, 5, 6, 7, 9, 11, 13 |
| 回報日內完成 | 9 / 11 |
| 非回報日回報 | 2（POD 14、16） |
| 儀表板顯示 | 100% |
| 僅計回報日 | 81.8% |

其餘四例目前 POD 皆 ≤ 7，仍在每日回報階段，尚未出現非回報日回報。

### 關於這兩筆非回報日回報的成因

初步假設為受試者將「第二週每兩日一次」理解為自 POD 8 起算（8、10、12），與系統的 9、11、13 相差一天。此假設與資料不符：HSF-001 在 POD 9 與 11 均有回報，相位與系統一致。實際情形是 POD 13 未回報、POD 14 補交，其後以 14 為起點每兩日推進至 16。相位是在中途因一次延遲而重新起算的。

「每兩日一次」存在兩種讀法：綁定日曆（9、11、13 固定）或綁定前次回報（上次完成後隔兩日）。系統實作前者，受試者在漏掉一次後自然滑向後者。WCC-001 與 WCC-002 於 2026-08-13 進入第二週，可提供兩個獨立樣本檢驗此現象是否普遍。

### 待決定

adherence 的分子是否限定於回報日。兩種算法都能從原始資料重建，`report_date` 與 `surgery_date` 均完整保留。若採嚴格定義，非回報日的自發回報可另列為次要描述性指標。

## 介入變更：2026-08-12 的提醒排程修正

本日修正了 App 內提醒排程的一個缺陷，該修正改變了受試者實際接收提醒的行為。

修正前，`startReminderScheduler` 僅判斷「今日尚未回報且已過設定時間」，未考慮回報日。POD 8、10、12、15、16 等非回報日，只要 App 開啟即會提醒。修正後新增 `isReportDay()`，比照 `fn_report_days()`，僅於回報日提醒；術前（POD 為負）與無手術日期者不提醒。

伺服器端的 `check-adherence` 自 2026-08-02 起即已依 `fn_report_days()` 排程，本次修正使前端與之一致。

對量測的影響：2026-08-12 之前收案者（HSF-001、HSF-002、WCC-001、WCC-002）經歷的是舊版提醒行為，之後收案者經歷新版。提醒策略屬於介入的一部分，兩組的 adherence 嚴格而言不可直接合併。

相關 commit：`8d26835`（文案）、`51eeb70`（排程）、`79d787a`（文案補漏）。詳見 `研究日誌/2026-08-12.yaml`。

### 待決定

分析時是否依提醒策略分層，或於 limitation 說明。就目前樣本數（修正前 4 例）而言，分層恐無實益，但需在論文中載明變更時點。

## 重建用的查詢

三個指標均可自原始資料重建，無需修改 production。

啟用率（依三種定義）：

```sql
SELECT p.study_id,
       (u.last_sign_in_at IS NOT NULL)                                   AS signed_in,
       (SELECT min(r.report_date) FROM symptom_reports r
         WHERE r.study_id = p.study_id)                                  AS first_report
FROM patients p
LEFT JOIN auth.users u ON (u.raw_user_meta_data->>'study_id') = p.study_id
WHERE p.study_id <> 'TEST-001';
```

adherence（兩種定義並列）：

```sql
SELECT p.study_id,
       count(r.id)                                                       AS total_reports,
       count(r.id) FILTER (WHERE (r.report_date - p.surgery_date)
                                 IN (SELECT * FROM fn_report_days()))     AS on_schedule,
       fn_expected_reports(GREATEST(0, CURRENT_DATE - p.surgery_date))    AS expected
FROM patients p
LEFT JOIN symptom_reports r ON r.study_id = p.study_id
WHERE p.study_status <> 'withdrawn' AND p.study_id <> 'TEST-001'
GROUP BY p.study_id, p.surgery_date;
```

POD 0-7 完成 ≥5 次：

```sql
SELECT p.study_id,
       count(r.id) FILTER (WHERE (r.report_date - p.surgery_date) BETWEEN 0 AND 7) AS reports_pod0_7,
       (CURRENT_DATE - p.surgery_date >= 7)                                        AS window_complete
FROM patients p
LEFT JOIN symptom_reports r ON r.study_id = p.study_id
WHERE p.study_id <> 'TEST-001'
GROUP BY p.study_id, p.surgery_date;
```

## 待決事項彙整

| # | 事項 | 影響 | 時機 |
|---|---|---|---|
| 1 | 「啟用」的操作型定義 | 啟用率分子；FIH-001 一例之歸類 | 分析前 |
| 2 | adherence 分子是否限定回報日 | HSF-001 為 100% 或 81.8% | 分析前 |
| 3 | 提醒策略變更是否分層或列入 limitation | 論文方法與限制段落 | 撰稿前 |
| 4 | `app_activated` 補上寫入邏輯，或於 SAP 明訂不使用 | 避免將來誤用該欄位得出 0% | 收案結束後 |

第 4 項最不該擱置。維持現狀的話，將來有人直接拿這個欄位算啟用率，會得到 0% 而且不會察覺哪裡不對。

## 未涵蓋

- 未檢視 PWA 安裝率是否有其他可用的間接證據（例如推播訂閱紀錄 `push_subscriptions`）。若受試者曾成功訂閱推播，於 iOS 上即隱含已加入主畫面，此推論尚未驗證。
- 未檢視次要結局指標（非預期就醫、滿意度）的量測是否有類似缺口。
