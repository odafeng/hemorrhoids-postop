# AI-Chat Uptime 監控（health endpoint + 外部心跳）

**日期**：2026-07-26
**狀態**：已實作。health 函式與 `HEALTH_TOKEN` 依此設計上線。**唯一偏離**：探針**不用**
GitHub Actions cron + Healthchecks.io（GitHub 把 `*/5` 節流到 ~29 分，導致 HC dead man's
switch 假性 flapping），改用 **Better Stack 主動探針**直打 token'd endpoint。詳見維運日誌
2026-07-26「uptime 探針改用 Better Stack」。
**背景需求**：ai-chat 是本研究的臨床介入，收案期間**不能默默斷線而無人察覺**。
現行低流量 pilot（HSF-001 POD 2）無法靠「有沒有病人在用」判斷死活——沒人用是常態，
不是故障。最陰險的失效是 **Anthropic 額度用完**：網站首頁照樣回 200，一按聊天就 500，
單純 ping 首頁抓不到。需要一個**主動戳到依賴鏈**、且斷了會**推到 PI 手機**的監控。

## 目標

1. 主動偵測 ai-chat 依賴鏈（Anthropic 生成含額度、Supabase DB/pgvector）是否可用。
2. 故障時於數分鐘內推播到 PI 手機（沿用既有 ntfy）。
3. 連「探針自己掛掉」都要能被發現（dead man's switch）。

## 非目標（YAGNI）

- 不做 SLA 報表、不做多區域探測、不做自動修復/自動重啟。
- 不改動 `ai-chat` 函式本身（介入零觸碰）。
- 不做 Anthropic 餘額查詢 API（無乾淨公開 API；改由 canary 撞到額度錯誤來涵蓋）。
- 不追求秒級偵測（pilot 可接受約 5 分鐘；要秒級才需換主動探針如 Better Stack）。

## 架構決策：為什麼是「health endpoint + 心跳」而非單一主動探針

- **Healthchecks.io 是 dead man's switch，不是主動探針**：它不會主動來打我方 URL，
  而是等我方定時去 ping 它；該來的 ping 沒來（或收到 `/fail`）才告警。
- 因此需要一個**探針**定時戳 health endpoint，再把成敗回報給 HC。探針選 GitHub Actions
  cron，理由是它**獨立於 Supabase**（不會與被監控對象同生共死），且用既有 repo、零外部廠商。
- 副作用（正向）：探針自己死掉 → 心跳沒來 → HC 仍會告警，安全網更完整。
- 代價：GH cron 約 5 分鐘且可能被延遲，偵測不是秒級。若日後要秒級，改接 Better Stack
  主動探針即可，health endpoint 可沿用。

## 元件與改動

### 1. `prototype/supabase/functions/health/index.ts`（新增）
- 公開 GET，帶 `?token=` 共用密鑰（避免被亂戳而觸發 Anthropic 呼叫）；token 值放函式
  環境變數，**不進 repo**。
- 並行執行三項檢查：
  - **Anthropic（致命）**：`POST /v1/messages`，`claude-haiku-4-5-20251001`，
    `max_tokens: 1`，極小 prompt。真的走一次生成 → **會撞到額度耗盡**（成本趨近於零，
    約每次 $0.00002）。
  - **Supabase DB（致命）**：一個輕量查詢（`select 1` 或數 `rag_documents`）→ 驗
    DB 與 pgvector 可達。
  - **OpenAI（非致命）**：`GET /v1/models`（免費）→ embedding 金鑰失效只當 warning，
    因為 RAG 缺 OpenAI 是既有的 non-fatal 降級（`ai-chat/index.ts:133`）。
- 回傳：Anthropic && DB 皆正常 → `200`；任一致命項失敗 → `503`。
  body：`{ status, checks: { anthropic, db, openai }, ts }`。**絕不回傳任何金鑰內容**，
  只回布林/狀態字串。
- 金鑰沿用既有函式 secrets（`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / DB 存取），
  唯一新增 secret 是 health token。

### 2. `.github/workflows/uptime.yml`（新增）
- 排程 `*/5 * * * *`（約 5 分鐘）＋ 支援 `workflow_dispatch` 手動觸發驗證。
- 步驟：curl health endpoint（帶 token，20s timeout，**失敗先重試 1 次**再判定，
  避免 cold-start 誤報）。
  - HTTP 200 → ping HC 成功 URL。
  - 非 200 / timeout → ping HC `/fail` 並附錯誤 body → HC 立即告警。
- Secrets（GH Actions secrets，不進 repo）：`HEALTH_URL`、`HEALTH_TOKEN`、`HC_UUID`。
- 放 repo 根目錄 `.github/`（依 [[deployment-topology]]，`prototype/.github/` 為 dead）。

### 3. Healthchecks.io（外部設定，非程式碼）
- 一個 check：period 5 分、grace 6–8 分。
- 整合：**ntfy（推 PI 手機，既有）** + email 雙保險。
- 主動故障（`/fail`）立即告警；探針停跑（心跳缺席）→ dead man 告警。

### 4. 韌性補充（確認即可，非本次實作主體）
- 額度告警由 Anthropic canary 涵蓋（撞到 402/400 即為警報）。
- 確認前端聊天失敗時顯示 graceful「請稍後再試」而非白畫面卡死
  （`src/utils/claudeService.js` 錯誤路徑）。
- 確認即使 AI 全掛，8 大類**靜態衛教內容仍內建於 PWA**，病人不開天窗（既有降級）。

## 測試

- **health 函式**：本地 `supabase functions serve`
  - 正常金鑰 → 回 200 且 body 三項皆 ok、JSON 形狀正確。
  - 故意給錯 `ANTHROPIC_API_KEY`（或錯 token）→ 回 503 且 `checks.anthropic` 為 fail。
  - OpenAI 金鑰缺失 → 仍回 200，`checks.openai` 為 warning（非致命）。
- **探針 / 告警端到端**：`workflow_dispatch` 手動跑一次
  - 正常 → HC 收到心跳、狀態 up。
  - 暫時把 `HEALTH_TOKEN` 設錯 → 探針收 503 → HC `/fail` → **手機收到告警**（驗證整條鏈）。

## 部署與風險

- health 函式走 **Edge Function 部署路徑**（root `ci.yml` 的 Edge Function job），
  **獨立於 Vercel 前端、也不觸碰 `ai-chat` 介入**。依 [[no-deploy-during-enrolment]]，
  這是**純附加、非介入**的 ops 變更：**不需要更新病人端 banner**（前端無變動）。
- blast radius：僅新增一支獨立函式與一個 CI workflow；現有 `ai-chat` 路徑完全不動。
- 依 [[repo-is-public]]：所有金鑰、health token、HC UUID、含 token 的 URL **一律走
  secrets**，spec 與程式碼內不得出現實際值。

## 已定案決策

1. 探針用 **GitHub Actions cron**（獨立於 Supabase），告警大腦用 **Healthchecks.io**，
   推播沿用 **ntfy**。接受約 5 分鐘偵測延遲，換取零外部探針廠商與 dead-man 安全網。
2. Anthropic 檢查用 **`max_tokens:1` 生成 canary**（而非 `GET /v1/models`），
   為的是能撞到「額度耗盡」這個最陰險的失效；成本可忽略。
3. health 函式為**純附加、不碰 ai-chat**，因此在收案期間可部署，且不需 banner。
