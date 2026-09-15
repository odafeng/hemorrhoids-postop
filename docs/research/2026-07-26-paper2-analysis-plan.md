# Paper 2 — Analysis Plan（草稿 v0.1）

**日期**：2026-07-26 · **狀態**：草稿待 PI 審 · **性質**：未發表研究策略，**勿推上公開 repo**

> 定位：本計畫的第二篇論文，以 App 收集的 PRO 資料為主。主打**術後急性恢復期的高解析
> trajectory + 恢復 phenotype**；surgery / 自費關聯為**探索性**。單臂觀察，**不宣稱療效**。

---

## 1. 目標

- **主要**：描述痔瘡切除術後**急性恢復期（POD 1–7 每日）**的症狀 trajectory（以 pain NRS 為核心），
  並延伸描述至 POD 30。
- **次要**：以 trajectory modeling 找出**恢復 phenotype**（如快速緩解 / 遷延疼痛 / 併發症型）。
- **探索性**：surgery type、自費品項與 trajectory / phenotype 的關聯（**hypothesis-generating，非因果**）。
- **安全面**：描述系統警示事件（血塊、持續出血、發燒）之發生率與時間分布。

## 2. 設計與資料來源

- 前瞻、單中心（KSVGH 大腸直腸外科）、**單臂觀察** cohort；經 App 收集 ePRO。
- IRB Ver 2；目標 n=50；8 位主刀醫師（surgeon 前綴 HSF/HCW/WJH/CPT/WCC/LMH/CYH/FIH）。
- 排除：TEST-% 帳號、撤案者。

## 3. 取樣排程（**不等距，需連續時間建模**）

| 期間 | 頻率 | 約略點數 |
|---|---|---|
| POD 1–7 | 每日 | 7 |
| POD 8–14 | 每 2 天 | 3–4 |
| POD 15–30 | 每週 | 2 |

→ 每人約 12–13 點、**前重後輕**。**後段（POD15–30）為低解析、by design**；對「後期」之主張須保守。

## 4. 變項

- **主要 PRO**：pain NRS（0–10，**primary**）。
- **次要 PRO**：bleeding、bowel、fever、wound、urinary、continence（取值集合見另附 metadata 字典）。
- **共變量 / metadata**：surgery type、自費品項、age、sex、baseline；surgeon（視為 cluster / random effect）。
- **依從 / engagement**（同時餵 Paper 1）：各排定時點之**回報完成率**、AI chat 使用次數。

## 5. 主要分析（描述性 trajectory）

- **Pain NRS 隨時間**：mixed-effects model，時間以**連續變數**建模（restricted cubic spline 或多項式），
  以吃下不等距取樣；random intercept（+slope）於 patient，surgeon 為額外 random effect。
  報告：**peak NRS 時點**、**time to NRS<3**（緩解）、POD7 / POD14 邊際估計。
- **類別型 PRO（bleeding/bowel/…）**：各時點比例 + 隨時間變化（longitudinal，如 GEE / ordinal mixed）。
- **重心放急性期（POD1–7）**——文獻最缺、臨床最有意義的一段。

## 6. 次要分析（恢復 phenotype）

- 對 pain NRS 做 **group-based trajectory modeling（GBTM）/ latent class growth analysis**
  （連續時間，容許不等距）。報告：model selection（BIC）、class 數與各 class 佔比、平均軌跡圖。
- **n=50 對 GBTM 偏小 → 明確標為 exploratory**；class 數上限保守（≤3–4），避免過度擬合。

## 7. 探索性關聯（**明確 hypothesis-generating**）

- surgery type → trajectory 參數 / phenotype class。
- 自費品項 → trajectory / phenotype / outcome。
  - **強烈 confounding 警語**：自費為病人自我選擇（經濟、case mix、醫師選擇）→ **不得宣稱因果、不得暗示某品項較優**。
  - 僅報告 effect size + 95% CI，**不做 p 值獵取**；預先限定少數幾個對照，不遍歷所有組合。
- multiplicity：主/次分析與探索分析分層陳述；探索部分不做正式推論。

## 8. 安全 / 併發症 surveillance

- 警示事件（血塊、連續 2 次「持續」出血、發燒）之發生率、時間分布、後續處置（若可得）。

## 9. 缺失資料

- 依**排定時點**量化完成率；區分「排程本就不採」與「排程內未填（true missing）」。
- mixed / GBTM 於 MAR 假設下用全部可得觀測；必要時做 sensitivity（如 completers-only）。

## 10. 樣本數說明

- Pilot / feasibility；**n=50 由計畫書固定**。用於描述性精度，**未 power 於關聯檢定**；關聯一律探索性。

## 11. 軟體

- R：`lme4` / `nlme`（mixed）、`rms`（spline）、`lcmm` 或 `traj`（GBTM）、`geepack`（GEE）。

## 12. 需事先聲明的限制（誠實寫進 paper）

- 單中心、單一團隊、n=50、**單臂（無對照 → 不能歸因療效）**。
- 自費 selection confounding。
- **不等距取樣 → 後段解析低**；trajectory 貢獻定位於**急性期**。
- ePRO 依從率影響完整度；AI 介入可用性（含監控前之潛在中斷）須揭露。

---

## 待 PI 決定 / 補充

1. surgery type 的**分類集合**（見 metadata 字典草稿）。
2. 自費品項的**分類集合**與記錄粒度（單品項？組合？金額級距?）。
3. 主要 endpoint 是否確定為 pain NRS trajectory（或改 time-to-resolution）。
4. 是否納入 baseline（術前 pain / 痔瘡分級 / 手術術式細節）以利校正。
