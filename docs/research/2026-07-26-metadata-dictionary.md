# Metadata 資料字典（草稿 v0.1）

**日期**：2026-07-26 · **狀態**：草稿待 PI 確認 · **勿推上公開 repo**
**來源**：前端 `src/pages/SurgicalRecord.jsx` 的選項定義 + DB `surgical_records` / `patients`。
**用途**：Paper 2 分析的變項編碼依據。

> ⚠️ **全部欄位在 DB 端皆無 enum / CHECK 約束**（varchar / text / jsonb / array）；取值僅由前端表單把關。
> ⚠️ **`patients.surgery_type / hemorrhoid_grade / anesthesia_type` 為舊欄位、現為 NULL**——
> **分析一律以 `surgical_records` 為準**；`patients` 只取 `age / sex / bmi / surgery_date`。

---

## A. 手術 metadata（`surgical_records`，以 `study_id` join）

| 欄位 | 型別 | 取值集合（canonical） | 分析備註 |
|---|---|---|---|
| `procedure_type` | varchar | `hemorrhoidectomy` / `laser_hemorrhoidoplasty` | **只有 2 種**——見待確認 Q1 |
| `hemorrhoidectomy_subtype` | varchar | `open` / `closed` / `semi_open` / `semi_closed`（非 hemorrhoidectomy 為 null） | Ferguson=closed |
| `hemorrhoid_grade` | varchar | `I` / `II` / `III` / `IV` | baseline 嚴重度共變量 |
| `anesthesia_type` | text | `IVGA` / `LMGA` / `SA` / `LA` | |
| `patient_position` | varchar | `lithotomy` / `prone_jackknife` / `left_lateral` / `other` | `other` → 自由文字風險 |
| `clock_positions` | int[] | 1–12 | 病灶鐘面位置 |
| `energy_device` | text[] | `ligasure` / `powerseal` / `harmonic`（可多選；laser 或無為 []） | |
| `laser_joules` | jsonb | `{3,7,11}`→焦耳 | laser 專用 |
| `blood_loss_ml` | int | 數值 | |
| `duration_min` | int | 數值 | |
| `combined_partial_hemorrhoidectomy` | bool | + `_positions` int[] | laser 專用 |
| `pedicle_ligation` | bool | + `_positions` int[] | |
| `mucosal_injury` | bool | + `_repaired` bool + `_positions` int[] | |
| `skin_tags` | bool | | |
| `thrombus` | bool | | |
| `suture_material` | text | **自由文字** | ⚠️ 需標準化 |

## B. 自費品項（`surgical_records.self_paid`，jsonb 物件）

| key | 型別 | 取值 | 備註 |
|---|---|---|---|
| `hemostatic_gauze` | array | `quikclot` / `military`(國軍) / `other` | + `hemostatic_gauze_other`（自由文字） |
| `wound_gel` | array | `liquidband` / `glitch` / `other` | + `wound_gel_other`（自由文字） |
| `wound_spray` | array | `newepi` / `other` | + `wound_spray_other`（自由文字）；舊 `newepi` bool 已併入 |
| `prp` | bool | + `prp_brand`（自由文字） | 富血小板血漿 |
| `healiaid` | bool | | |
| `other` | text | **自由文字** | 泛用其他 |

分析用衍生變項建議（在 R 端建，不改 App）：
- `any_self_paid`（是否有任一自費）、各大類的 binary（gauze/gel/spray/prp/healiaid）。
- 自費**只當探索性 exposure**，因 selection confounding（見 analysis plan §7）。

## C. 病人 baseline（`patients`）

| 欄位 | 型別 | 取值 | 備註 |
|---|---|---|---|
| `age` | int | 數值 | |
| `sex` | varchar | **待確認**（M/F? 男/女?）——見 Q2 | |
| `bmi` | numeric | 數值 | |
| `surgery_date` | date | | POD 計算基準（daily_summary 已用） |

## D. 症狀 PRO enum（`symptom_reports`，前端 `schemaContract.js`）

| 欄位 | 取值 | 觸發警示 |
|---|---|---|
| `pain_nrs` | 0–10 | — |
| `bleeding` | `無`/`少量`/`持續`/`血塊` | 持續(連 2 次)、血塊(當次) |
| `bowel` | `正常`/`困難`/`未排` | 未排 |
| `fever` | boolean | true |
| `wound` | `無異常`/`腫脹`/…（待補全） | |
| `urinary` | `正常`/`尿不出來`/…（待補全） | 尿不出來 |
| `continence` | `正常`/`滲便`/`失禁`/…（待補全） | 滲便、失禁 |

---

## 分析風險（要在收案期間管，不然 Paper 2 難跑）

1. **自由文字欄位**（`*_other`、`suture_material`、`other`、position=`other`、`prp_brand`）：
   n=50 建議**定期人工檢視**，把反覆出現的 `_other` 收斂進固定清單，或維護一份 coding log。
2. **無 DB 約束**：值只靠前端。可考慮補 CHECK constraint（但屬 schema 變更，收案期間須謹慎——見 Q4）。
3. **舊欄位混淆**：勿誤用 `patients.surgery_type`（NULL）；一律 join `surgical_records`。

## 待 PI 確認（Q1–Q4）

- **Q1 procedure_type 只有 2 種夠嗎?** 你的臨床實務有沒有 PPH / stapled、THD / HAL、rubber band 等?
  若有卻沒選項,會被迫誤編。
- **Q2 `sex` 的實際存值是什麼?**（決定編碼）
- **Q3 自費品項清單完整嗎?**（gauze / gel / spray / PRP / Healiaid 之外還有常用的嗎?）
- **Q4 要不要現在補 DB 層 CHECK 約束?** 趁 N 小最好做,但屬 prod schema 變更,需排非收案窗口 +
  依 [[supabase-migration-history-desync]] 手動套用,不可 `db push`。
