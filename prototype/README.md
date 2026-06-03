# Prototype — 痔瘡術後追蹤 PWA

React 19 + Vite 8 前端 + Supabase 後端（Auth / PostgreSQL / Edge Functions / RLS）+ Sentry 監控。

## 架構概覽

```
病人手機（PWA）
  ├── Dashboard — POD 計數、今日回報摘要、警示、回報率、推播設定
  ├── SymptomReport — NRS 疼痛、出血、排便、發燒、排尿、控便、傷口
  ├── History — 時間軸 + 疼痛趨勢圖（POD 0 顯示為 OP）
  └── AIChat — Claude Haiku API 衛教聊天（RAG + SSE streaming）

研究者（Web）
  ├── ResearcherDashboard — 收案總覽、依從率、警示、AI 審核、數據圖表（疼痛趨勢/依從率/症狀分佈/收案進度）
  ├── ResearcherPatientLookup — 單一病人狀態查詢
  └── ChatReview — AI 對話紀錄審核

後端
  ├── Supabase Auth — JWT + RLS（patient / researcher / pi）
  ├── PostgreSQL Triggers — fn_check_alerts() + fn_audit_report_submit()
  ├── PostgreSQL pgvector — rag_documents（106 chunks，cosine similarity search）
  ├── Edge Functions — ai-chat / patient-onboard / check-adherence / health
  ├── Web Push — VAPID + RFC 8291（check-adherence → 推播未回報病人）
  └── GitHub Actions — CI + Cron（adherence）+ Backup + Uptime
```

## 部署步驟

### 1. Supabase 設定

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>

# 套用所有 migrations
supabase db push
```

### 2. VAPID Keys（Web Push 推播）

```bash
node scripts/generate-vapid-keys.mjs
```

輸出的 keys 設定到下方環境變數。

### 3. Edge Functions 部署

```bash
# 同步 AI system prompt
npm run sync-prompt

# 部署 Edge Functions
supabase functions deploy ai-chat              # JWT 驗證（gateway + function 雙層）
supabase functions deploy patient-onboard      # JWT 驗證 + invite token 驗證
supabase functions deploy check-adherence --no-verify-jwt  # CRON_SECRET 驗證
supabase functions deploy health --no-verify-jwt  # 公開健康檢查
```

### 4. RAG 衛教知識庫

```bash
# 將 rag/ 下的 .md + .pdf 檔案 chunk + embed + 存入 pgvector
node --env-file=.env scripts/ingest-rag.mjs
# 更新衛教文件後，重跑上面這行即可
```

### 4. 環境變數

**Supabase Edge Function Secrets**（`supabase secrets set KEY=VALUE`）：

| 變數 | 說明 |
|------|------|
| `CLAUDE_API_KEY` | Anthropic Claude API key（Haiku, SSE streaming） |
| `OPENAI_API_KEY` | OpenAI API key（RAG embedding） |
| `CRON_SECRET` | check-adherence cron 驗證密碼 |
| `VAPID_PUBLIC_KEY` | Web Push VAPID 公鑰 |
| `VAPID_PRIVATE_KEY` | Web Push VAPID 私鑰 |
| `VAPID_SUBJECT` | `mailto:your-email@example.com` |
| ~~`GLOBAL_INVITE_TOKEN`~~ | 已移除 — 改用 per-patient invite token（study_invites 表） |

**Vercel 環境變數**：

| 變數 | 說明 |
|------|------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_VAPID_PUBLIC_KEY` | Web Push VAPID 公鑰（與 Supabase 同一把） |
| `VITE_SENTRY_DSN` | Sentry error tracking DSN |

**GitHub Secrets**（Settings → Secrets → Actions）：

| Secret | 說明 |
|--------|------|
| `SUPABASE_URL` | Supabase project URL |
| `CRON_SECRET` | 與 Edge Function 相同 |

### 5. 前端部署

```bash
npm install
vercel --prod
```

### 6. 帳號

**研究者**：在 Supabase Dashboard → Authentication → Users → Add User，metadata 設：
```json
{ "role": "researcher", "study_id": "RESEARCHER-001" }
```

**病人**：研究人員先在概覽頁產生 per-patient 邀請碼 → 病人透過 App 註冊頁面輸入邀請碼 + study_id + 手術日期。

## 開發

```bash
npm run dev            # 開發模式 (port 5173)
npm test               # 117 unit tests
npm run build          # Production build
npm run sync-prompt    # 同步 system prompt → Edge Function
node --env-file=.env scripts/ingest-rag.mjs  # 重新 ingest 衛教知識庫
```

## RAG 衛教知識庫

AI chat 使用 Retrieval-Augmented Generation（RAG）從衛教知識庫檢索相關段落，搭配 SSE streaming 逐字顯示：

```
病人提問 → OpenAI embedding → pgvector cosine search → top-3 chunks
        → stripMd() 去除 markdown → 注入 Claude Haiku system prompt
        → SSE streaming 逐字回覆（附 citation sources）
```

Model: `claude-haiku-4-5-20251001`（RAG grounding 不需要 Sonnet 推理能力，Haiku 快 3-5x、便宜 10x）
Fallback: RAG 未命中時回覆固定安全模板，不使用模型通用知識

| 來源 | 檔案數 | Chunks |
|------|--------|--------|
| 衛教 markdown | 8 篇 | 71 |
| 臨床指引 PDF | 3 篇（ASCRS / ESCP / 2025 review） | 35 |
| **總計** | **11** | **106** |

知識庫位於 `rag/` 目錄。修改後重跑 `node --env-file=.env scripts/ingest-rag.mjs` 即可更新。

## 推播通知機制

兩層保障：

1. **Web Push（主要）**：GitHub Actions cron 每天 12:00 / 20:00 觸發 `check-adherence` Edge Function → 查未回報病人 → 透過 VAPID + Web Push API 發送推播 → SW 收到後彈系統通知 → 點擊開啟 App。**即使 App 關著也收得到。**

2. **Client-side scheduler（備用）**：App 開著時，每 15 分鐘檢查是否已過提醒時間且未回報 → 透過 Service Worker 彈本機通知。

通知偏好同步到 `notification_preferences` table，跨裝置一致。

## Alert 引擎

**Server-side only**（PostgreSQL Trigger `fn_check_alerts()`），INSERT 和 UPDATE 都會觸發：

| 規則 | 條件 | 等級 |
|------|------|------|
| 持續高痛 | NRS ≥ 8 連續 3 天 | danger |
| 持續出血 | 「持續」連續 2 次 | danger |
| 血塊 | 單次 | danger |
| 未排便 | 連續 3 天 | warning |
| 發燒 | 單次 | danger |
| 尿滯留 | 「尿不出來」單次 | danger |
| 排尿困難 | 「困難」連續 2 天 | warning |
| 失禁 | 單次 | danger |
| 滲便 | 連續 2 天 | warning |

Client-side `checkAlerts()` 僅用於 Demo mode。

## Onboarding 流程

病人註冊 → 輸入邀請碼 → `patient-onboard` Edge Function 驗證（優先查 `study_invites` table per-patient token → fallback 到 `GLOBAL_INVITE_TOKEN`）→ 建立 patient record → audit trail。

## 測試

```
10 test files, 117 tests:
├── alerts.test.js          — 17 alert rules
├── high-risk.test.js       — 11 auth + edge cases + errorLogger
├── mockAI.test.js          — 14 mock AI responses
├── storage.test.js         — 16 localStorage operations
├── schemaAlignment.test.js — 16 schema contract smoke tests (DB ↔ frontend ↔ migrations)
├── AIChat.test.jsx         — 7 AI chat UI
├── Dashboard.test.jsx      — 10 dashboard rendering
├── History.test.jsx        — 7 history display
├── Login.test.jsx          — 8 login/register flow
└── SymptomReport.test.jsx  — 11 symptom report form
```

DB trigger 測試（手動在 SQL Editor 執行）：`supabase/tests/test_alert_triggers.sql`（16 tests，含 UPDATE / dedup / re-trigger / correction）

E2E 測試（Playwright，CI 自動執行）：

```
3 test files, 14 tests:
├── demo-flow.spec.ts       — 6 tests（Patient smoke + Researcher smoke，不需 Supabase）
├── auth-flow.spec.ts       — 4 tests（登入 → 症狀回報 → History 驗資料 → AI 衛教 → 登出）
└── researcher-flow.spec.ts — 4 tests（研究者登入 → Dashboard → Patient lookup → Chat review → 登出）
```

## Schema 來源

- **Source of Truth**：`supabase/migrations/` 目錄下的 ordered migration files
- **db/schema.sql**：僅供參考（reference only），可能與最新 migration 有差異
- **Schema Contract**：`src/utils/schemaContract.js` 定義 frontend ↔ DB 欄位對應，CI 自動驗證
- 最新完整 schema：`supabase db dump --schema public > db/schema_snapshot.sql`

## System Prompt 維護

- **唯一來源**：`shared/system-prompt.json`
- **同步機制**：`npm run sync-prompt` → 產生 `supabase/functions/ai-chat/_prompt.ts`
- **CI**：deploy 前自動執行 `predeploy` script 同步
- **更新**：修改 JSON → `npm run sync-prompt` → `supabase functions deploy ai-chat`

## Audit Trail

所有關鍵操作記錄到 `audit_trail` table，詳見 `docs/audit-trail-events.md`。

涵蓋事件：`report.submit`、`alert.create`、`patient.onboard`、`ai.chat_request`、`researcher.review_chat`、`cron.check_adherence`。

## 文件

| 文件 | 用途 |
|------|------|
| `docs/audit-trail-events.md` | Audit trail 事件對照表（IRB / paper methods 用） |
| `docs/pwa-smoke-test.md` | PWA vs Web 一致性手動測試 checklist |
| `docs/KNOWN_LIMITATIONS.md` | 已知限制與技術決策 |
| `hemorrhoid_postop_ai_plan.md` | 研究計畫書（IRB 用） |
