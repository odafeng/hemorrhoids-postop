# 研究者：病人逐日回報明細 + 疼痛趨勢 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓研究者從概覽點進任一病人，看到該病人的疼痛 NRS 趨勢圖與逐日回報明細（唯讀）。

**Architecture:** 全部落在研究者面向頁面。病人詳情沿用「查詢」頁 `ResearcherPatientLookup` 同一實作，新增 `/lookup/:studyId` 路由自動載入；概覽 cohort 每列可點進去。資料用既有的 `getAllReports(studyId)`，不動資料層、不碰病人面向的 `History.jsx`。

**Tech Stack:** React 18 (JSX)、react-router-dom、Vitest + @testing-library/react、既有 CSS class（`tl-item` / `sym-list` / `chart-card` 等）。

## Global Constraints

- 語言：UI 文案繁體中文；技術識別字保留英文。
- 不新增任何 Supabase 查詢或資料層函式；只消費既有的 `sb.getPatient` / `sb.getAllReports` / `sb.getAlerts`。
- **不得**修改病人面向的 `src/pages/History.jsx`（趨勢圖研究者頁自帶一份）。
- 原始回報列欄位名：`report_date` / `pod` / `pain_nrs` / `bleeding` / `bowel` / `fever` / `wound` / `urinary` / `continence`（`getAllReports` 已依 `report_date` descending 排序）。
- 傷口顯示用 `src/utils/schemaContract.js` 的 `isWoundNormal` / `formatWound`。
- 測試 render 用 `src/test-utils.jsx` 的 `TestQueryWrapper`（內含 `MemoryRouter` + `QueryClientProvider`）；需要路由參數的測試自備 `MemoryRouter` + `Routes`。
- commit 訊息用英文、Conventional Commits；每個 commit footer 加：
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` 與
  `Claude-Session: https://claude.ai/code/session_015Z7mzDxTjjcoXW5Vpf6D5G`。
- repo 為 public：`git add` 只加指定檔案，**絕不** `git add -A`。
- 部署：全部完成、測試綠燈後才部署，且排**傍晚/深夜**（收案期間），部署後以 test 帳號驗證。

## File Structure

- `src/pages/ResearcherPatientLookup.jsx`（改）— 查詢結果保留整份 reports；新增逐日明細 timeline、疼痛趨勢圖（頁內自帶 `PatientPainTrend` local component）；支援 `useParams` 的 `studyId` 自動載入。
- `src/App.jsx`（改）— 新增 `/lookup/:studyId` 路由。
- `src/pages/ResearcherDashboard.jsx`（改）— cohort 每列可點導覽至 `/lookup/:studyId`。
- `src/pages/__tests__/ResearcherPatientLookup.test.jsx`（新）— 逐日明細、空狀態、趨勢圖、路由自動載入測試。
- `src/pages/__tests__/ResearcherDashboard.test.jsx`（既有，改）— 補一則列可點導覽測試。

---

### Task 1: 逐日明細 timeline + 保留 reports

**Files:**
- Modify: `src/pages/ResearcherPatientLookup.jsx`（`handleLookup` 的 result 物件；result 渲染區塊）
- Test: `src/pages/__tests__/ResearcherPatientLookup.test.jsx`

**Interfaces:**
- Consumes: `sb.getPatient(studyId)`、`sb.getAllReports(studyId)`、`sb.getAlerts(studyId)`（皆既有）。
- Produces: `result.reports`（原始回報列陣列，供 Task 2 趨勢圖消費）。

- [ ] **Step 1: 寫失敗測試**

新增 `src/pages/__tests__/ResearcherPatientLookup.test.jsx`：

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TestQueryWrapper } from '../../test-utils';
import ResearcherPatientLookup from '../ResearcherPatientLookup';

vi.mock('../../utils/supabaseService', () => ({
  getPatient: vi.fn(),
  getAllReports: vi.fn(),
  getAlerts: vi.fn(),
  getPODFromDate: vi.fn(() => 2),
  getSignedSignatureUrl: vi.fn(),
  adminResetPassword: vi.fn(),
}));
import * as sb from '../../utils/supabaseService';

const TWO_REPORTS = [
  { report_date: '2026-07-26', pod: 2, pain_nrs: 3, bleeding: '少量', bowel: '正常', fever: false, wound: '無異常', urinary: '正常', continence: '正常' },
  { report_date: '2026-07-25', pod: 1, pain_nrs: 5, bleeding: '血塊', bowel: '未排', fever: false, wound: '腫脹', urinary: '正常', continence: '正常' },
];

async function lookup(studyId = 'HSF-001') {
  render(<ResearcherPatientLookup onNavigate={() => {}} isDemo={false} />, { wrapper: TestQueryWrapper });
  fireEvent.change(screen.getByPlaceholderText(/搜尋病人編號/), { target: { value: studyId } });
  fireEvent.click(screen.getByRole('button', { name: /查詢/ }));
}

describe('ResearcherPatientLookup — 逐日明細', () => {
  beforeEach(() => {
    sb.getPatient.mockResolvedValue({ study_id: 'HSF-001', study_status: 'active', surgery_date: '2026-07-24' });
    sb.getAlerts.mockResolvedValue([]);
  });

  it('查到病人後，逐日明細列出每天的 POD 與疼痛值', async () => {
    sb.getAllReports.mockResolvedValue(TWO_REPORTS);
    await lookup();
    await waitFor(() => expect(screen.getByText(/POD 2 · 2026-07-26/)).toBeInTheDocument());
    expect(screen.getByText(/POD 1 · 2026-07-25/)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('病人已建檔但 0 筆回報 → 顯示尚無回報紀錄', async () => {
    sb.getAllReports.mockResolvedValue([]);
    await lookup();
    await waitFor(() => expect(screen.getByText('尚無回報紀錄')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd prototype && npx vitest run src/pages/__tests__/ResearcherPatientLookup.test.jsx`
Expected: FAIL（找不到 `POD 2 · 2026-07-26` / `尚無回報紀錄`）。

- [ ] **Step 3: 最小實作 — 保留 reports**

在 `handleLookup` 內，`setResult({...})` 的物件補上 `reports`（`getAllReports` 回傳值）：

```jsx
setResult({
  studyId,
  patientExists: !!patient,
  patient,
  pod,
  reports,                       // ← 新增：整份逐日原始列
  totalReports: reports.length,
  latestReportDate: latestReport?.report_date || null,
  latestReportPain: latestReport?.pain_nrs ?? null,
  todayReported: !!todayReport,
  activeAlerts: activeAlerts.length,
  alertDetails: activeAlerts,
});
```

- [ ] **Step 4: 最小實作 — 渲染逐日明細**

在 CASE DETAIL 卡片（結尾 `</div>` 於 `result.patientExists` 區塊之後）與簽名/警示區塊之間，插入逐日明細。放在 `{result && !result.demo && (` 區塊內、CASE DETAIL 那張 `card` 結束後：

```jsx
{result.patientExists && (
  <>
    <div className="card-kicker" style={{ margin: '18px 4px 10px' }}>
      DAILY REPORTS · {result.reports.length}
    </div>
    {result.reports.length === 0 ? (
      <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 12.5 }}>
        尚無回報紀錄
      </div>
    ) : (
      result.reports.map((r) => {
        const pain = r.pain_nrs;
        const hasAlert = pain >= 8 || r.bleeding === '持續' || r.bleeding === '血塊' || r.fever || r.urinary === '尿不出來' || r.continence === '失禁';
        const concerning = !hasAlert && pain >= 5;
        const painTone = pain == null ? '' : pain <= 3 ? 'ok' : pain <= 6 ? 'warn' : 'danger';
        return (
          <div key={r.report_date} className={`tl-item ${hasAlert ? 'alert' : concerning ? 'warn' : 'ok'}`}>
            <div className="tl-date">{r.pod != null ? `POD ${r.pod}` : '—'} · {r.report_date}</div>
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="sym-list">
                <div className="sym-row"><span className="sym-name">疼痛</span>
                  <span className={`sym-val ${painTone}`}>{pain}<span className="unit">/10</span></span></div>
                <div className="sym-row"><span className="sym-name">出血</span>
                  <span className={`sym-val ${r.bleeding === '持續' || r.bleeding === '血塊' ? 'danger' : r.bleeding === '少量' ? 'warn' : 'ok'}`}>{r.bleeding}</span></div>
                <div className="sym-row"><span className="sym-name">排便</span>
                  <span className={`sym-val ${r.bowel === '未排' || r.bowel === '困難' ? 'warn' : 'ok'}`}>{r.bowel}</span></div>
                {r.fever && (
                  <div className="sym-row"><span className="sym-name">發燒</span>
                    <span className="sym-val danger">是</span></div>
                )}
                <div className="sym-row"><span className="sym-name">傷口</span>
                  <span className={`sym-val ${isWoundNormal(r.wound) ? 'ok' : 'warn'}`}>{formatWound(r.wound)}</span></div>
                {r.urinary && r.urinary !== '正常' && (
                  <div className="sym-row"><span className="sym-name">排尿</span>
                    <span className={`sym-val ${r.urinary === '尿不出來' ? 'danger' : 'warn'}`}>{r.urinary}</span></div>
                )}
                {r.continence && r.continence !== '正常' && (
                  <div className="sym-row"><span className="sym-name">肛門控制</span>
                    <span className={`sym-val ${r.continence === '失禁' ? 'danger' : 'warn'}`}>{r.continence}</span></div>
                )}
              </div>
            </div>
          </div>
        );
      })
    )}
  </>
)}
```

在檔案頂端 import 加入 schemaContract 工具：

```jsx
import { isWoundNormal, formatWound } from '../utils/schemaContract';
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd prototype && npx vitest run src/pages/__tests__/ResearcherPatientLookup.test.jsx`
Expected: PASS（兩則測試皆綠）。

- [ ] **Step 6: Commit**

```bash
cd "/Users/huangshifeng/Desktop/Research/AI_Clinical/痔瘡AI衛教"
git add prototype/src/pages/ResearcherPatientLookup.jsx prototype/src/pages/__tests__/ResearcherPatientLookup.test.jsx
git commit -m "$(cat <<'EOF'
feat(researcher): show per-patient day-by-day symptom timeline on lookup

Reuse the reports already fetched by getAllReports() to render a read-only
daily timeline below the case-detail card, with an empty state.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015Z7mzDxTjjcoXW5Vpf6D5G
EOF
)"
```

---

### Task 2: 疼痛趨勢圖（頁內自帶 `PatientPainTrend`）

**Files:**
- Modify: `src/pages/ResearcherPatientLookup.jsx`（新增 local component + 在明細上方渲染）
- Test: `src/pages/__tests__/ResearcherPatientLookup.test.jsx`

**Interfaces:**
- Consumes: `result.reports`（Task 1 產生）。
- Produces: 無（純呈現）。

- [ ] **Step 1: 寫失敗測試**

在測試檔的 describe 內新增：

```jsx
it('查到病人後渲染疼痛趨勢圖（SVG）與標題', async () => {
  sb.getAllReports.mockResolvedValue(TWO_REPORTS);
  const { container } = render(<ResearcherPatientLookup onNavigate={() => {}} isDemo={false} />, { wrapper: TestQueryWrapper });
  fireEvent.change(screen.getByPlaceholderText(/搜尋病人編號/), { target: { value: 'HSF-001' } });
  fireEvent.click(screen.getByRole('button', { name: /查詢/ }));
  await waitFor(() => expect(screen.getByText(/疼痛分數趨勢/)).toBeInTheDocument());
  expect(container.querySelector('svg')).toBeInTheDocument();
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd prototype && npx vitest run src/pages/__tests__/ResearcherPatientLookup.test.jsx -t 疼痛趨勢圖`
Expected: FAIL（找不到 `疼痛分數趨勢`）。

- [ ] **Step 3: 最小實作 — 新增 local component**

在 `ResearcherPatientLookup.jsx` 檔案底部（`export default function` 之外）新增自帶的趨勢圖元件（改寫自 History，不共用）：

```jsx
function PatientPainTrend({ reports }) {
  const [range, setRange] = useState(14);
  const asc = [...reports].map(r => ({ pain: r.pain_nrs, date: r.report_date, pod: r.pod }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const shown = range > 0 ? asc.slice(-range) : asc;
  if (shown.length === 0) return null;

  const W = 360, H = 140, padX = 26, padY = 18;
  const cW = W - padX * 2, cH = H - padY * 2;
  const pts = shown.map((r, i) => ({
    x: padX + (shown.length === 1 ? cW / 2 : (i / (shown.length - 1)) * cW),
    y: padY + cH - (r.pain / 10) * cH,
    pain: r.pain, date: r.date, pod: r.pod,
  }));
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <div className="card-kicker" style={{ marginBottom: 2 }}>PAIN NRS TREND</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>疼痛分數趨勢</div>
        </div>
        <div className="range-row">
          {[7, 14, 0].map((r) => (
            <button key={r} className={`range-chip ${range === r ? 'on' : ''}`} onClick={() => setRange(r)}>
              {r === 0 ? 'ALL' : `${r}D`}
            </button>
          ))}
        </div>
      </div>
      <div className="chart">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="painGradR" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 2, 4, 6, 8, 10].map((v) => {
            const y = padY + cH - (v / 10) * cH;
            return (
              <g key={v}>
                <line x1={padX} y1={y} x2={W - padX} y2={y} stroke="var(--chart-grid)" strokeWidth="1" strokeDasharray={v === 0 || v === 10 ? '' : '2 3'} />
                <text x={padX - 6} y={y + 3} fill="var(--ink-3)" fontSize="9" textAnchor="end" fontFamily="var(--font-mono)">{v}</text>
              </g>
            );
          })}
          {pts.length > 1 && (
            <>
              <path d={`${path} L ${pts[pts.length - 1].x} ${padY + cH} L ${pts[0].x} ${padY + cH} Z`} fill="url(#painGradR)" />
              <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}
          {pts.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="var(--surface)"
              stroke={p.pain >= 7 ? 'var(--danger)' : p.pain >= 4 ? 'var(--warn)' : 'var(--ok)'} strokeWidth="2" />
          ))}
          {pts.filter((_, i) => i === 0 || i === pts.length - 1 || i === Math.floor(pts.length / 2)).map((p, i) => (
            <text key={`pod-${i}`} x={p.x} y={H - 4} fill="var(--ink-3)" fontSize="9" textAnchor="middle" fontFamily="var(--font-mono)">
              {p.pod != null ? `POD ${p.pod}` : p.date.slice(5)}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}
```

確認頂端已 import `useState`（現有：`import { useState } from 'react';`）。

- [ ] **Step 4: 最小實作 — 渲染趨勢圖**

在 Task 1 的「DAILY REPORTS」kicker **之前**（即 CASE DETAIL 卡之後、明細之上），且僅在有回報時渲染：

```jsx
{result.patientExists && result.reports.length > 0 && (
  <PatientPainTrend reports={result.reports} />
)}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd prototype && npx vitest run src/pages/__tests__/ResearcherPatientLookup.test.jsx`
Expected: PASS（三則測試皆綠）。

- [ ] **Step 6: Commit**

```bash
cd "/Users/huangshifeng/Desktop/Research/AI_Clinical/痔瘡AI衛教"
git add prototype/src/pages/ResearcherPatientLookup.jsx prototype/src/pages/__tests__/ResearcherPatientLookup.test.jsx
git commit -m "$(cat <<'EOF'
feat(researcher): add per-patient pain NRS trend chart on lookup

Self-contained SVG line chart (own copy, not shared with History) above the
daily timeline, with 7D/14D/ALL range toggle.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015Z7mzDxTjjcoXW5Vpf6D5G
EOF
)"
```

---

### Task 3: `/lookup/:studyId` 路由自動載入

**Files:**
- Modify: `src/pages/ResearcherPatientLookup.jsx`（`useParams` 自動查詢）
- Modify: `src/App.jsx`（新增路由）
- Test: `src/pages/__tests__/ResearcherPatientLookup.test.jsx`

**Interfaces:**
- Consumes: react-router `useParams()` 的 `studyId`。
- Produces: 掛載時若有 `studyId` 參數則自動執行既有 `handleLookup` 邏輯。

- [ ] **Step 1: 寫失敗測試**

在測試檔新增（自備 Router + Routes 以提供路由參數）：

```jsx
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../../test-utils';

it('用 /lookup/:studyId 進入時自動載入該病人', async () => {
  sb.getAllReports.mockResolvedValue(TWO_REPORTS);
  const client = createTestQueryClient();
  render(
    <MemoryRouter initialEntries={['/lookup/HSF-001']}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/lookup/:studyId" element={<ResearcherPatientLookup onNavigate={() => {}} isDemo={false} />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByText(/POD 2 · 2026-07-26/)).toBeInTheDocument());
  expect(sb.getPatient).toHaveBeenCalledWith('HSF-001');
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd prototype && npx vitest run src/pages/__tests__/ResearcherPatientLookup.test.jsx -t 自動載入`
Expected: FAIL（未自動查詢，找不到 timeline）。

- [ ] **Step 3: 最小實作 — 自動載入**

在 `ResearcherPatientLookup.jsx`：
1. 頂端 import 加入 `useParams`、`useEffect`：

```jsx
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
```

2. 元件內取得參數並在掛載/參數變動時自動查詢。`handleLookup` 目前簽章是 `handleLookup(e)` 且 `e.preventDefault()`；改為可選 event 並抽出 studyId 來源：

```jsx
const { studyId: routeStudyId } = useParams();

// handleLookup 開頭改為：
const handleLookup = async (e) => {
  if (e && e.preventDefault) e.preventDefault();
  const studyId = (e && e.preventDefault ? query.trim() : (routeStudyId || query.trim()));
  ...
};
```

   為避免上面的三元判斷難讀，改用明確函式較佳：

```jsx
const runLookup = async (studyId) => {
  if (!studyId) return;
  setLoading(true); setError(''); setResult(null); setSigUrl(null); setSigError('');
  try {
    if (isDemo) { setResult({ demo: true, studyId }); return; }
    const [patient, reports, alerts] = await Promise.all([
      sb.getPatient(studyId), sb.getAllReports(studyId), sb.getAlerts(studyId),
    ]);
    const today = new Date().toLocaleDateString('en-CA');
    const todayReport = reports.find(r => r.report_date === today) || null;
    const activeAlerts = alerts.filter(a => !a.acknowledged);
    const latestReport = reports.length > 0 ? reports[0] : null;
    const pod = patient?.surgery_date ? sb.getPODFromDate(patient.surgery_date) : null;
    setResult({
      studyId, patientExists: !!patient, patient, pod, reports,
      totalReports: reports.length,
      latestReportDate: latestReport?.report_date || null,
      latestReportPain: latestReport?.pain_nrs ?? null,
      todayReported: !!todayReport,
      activeAlerts: activeAlerts.length, alertDetails: activeAlerts,
    });
  } catch (err) {
    setError(err.message || '查詢失敗');
  } finally {
    setLoading(false);
  }
};

const handleLookup = (e) => { e.preventDefault(); runLookup(query.trim()); };

useEffect(() => {
  if (routeStudyId) { setQuery(routeStudyId); runLookup(routeStudyId); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [routeStudyId]);
```

（把原本 `handleLookup` 的查詢邏輯搬進 `runLookup`；Task 1 對 result 物件的 `reports` 欄位一併保留在 `runLookup` 內。）

- [ ] **Step 4: 加入 App 路由**

`src/App.jsx` 在既有 `/lookup` 路由（約 303-305 行）旁新增：

```jsx
<Route path="/lookup/:studyId" element={<ResearcherPatientLookup onNavigate={(tab) => {
  navigate(tab === 'researcherDashboard' ? '/researcher' : '/lookup');
}} {...commonProps} />} />
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd prototype && npx vitest run src/pages/__tests__/ResearcherPatientLookup.test.jsx`
Expected: PASS（含自動載入，全綠）。

- [ ] **Step 6: Commit**

```bash
cd "/Users/huangshifeng/Desktop/Research/AI_Clinical/痔瘡AI衛教"
git add prototype/src/pages/ResearcherPatientLookup.jsx prototype/src/App.jsx prototype/src/pages/__tests__/ResearcherPatientLookup.test.jsx
git commit -m "$(cat <<'EOF'
feat(researcher): auto-load patient detail via /lookup/:studyId route

Extract runLookup() and auto-run it on mount when a studyId route param is
present, so the cohort list can link straight into a patient's detail.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015Z7mzDxTjjcoXW5Vpf6D5G
EOF
)"
```

---

### Task 4: 概覽 cohort 每列可點進病人詳情

**Files:**
- Modify: `src/pages/ResearcherDashboard.jsx`（cohort-row 可點 + 撰寫手術紀錄鈕 stopPropagation）
- Test: `src/pages/__tests__/ResearcherDashboard.test.jsx`

**Interfaces:**
- Consumes: `/lookup/:studyId` 路由（Task 3）。
- Produces: 無。

- [ ] **Step 1: 寫失敗測試**

先看 `src/pages/__tests__/ResearcherDashboard.test.jsx` 既有的 mock 與 render 樣式，沿用之。新增一則測試：非 demo 下，點 cohort 列會導覽到 `/lookup/<study_id>`。用一個顯示目前路徑的探針元件驗證：

```jsx
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}

it('點 cohort 列導覽到該病人詳情', async () => {
  // 沿用檔內既有 supabaseService mock，使 getAllPatients 至少回傳一位 active 病人 HSF-001
  const client = createTestQueryClient();
  render(
    <MemoryRouter initialEntries={['/researcher']}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/researcher" element={<ResearcherDashboard onNavigate={() => {}} isDemo={false} userInfo={{ role: 'pi' }} onLogout={() => {}} />} />
          <Route path="/lookup/:studyId" element={<LocationProbe />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
  const idCell = await screen.findByText('HSF-001');
  fireEvent.click(idCell.closest('.cohort-row'));
  await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/lookup/HSF-001'));
});
```

> 註：實作前先讀 `ResearcherDashboard.test.jsx` 頂端的 `vi.mock('../../utils/supabaseService', ...)`，確認 `getAllPatients` 回傳含 `HSF-001`、`study_status: 'active'`。若無，於該測試前用 `sb.getAllPatients.mockResolvedValue([{ study_id: 'HSF-001', surgeon_id: 'HSF', study_status: 'active', surgery_date: '2026-07-24' }])`，其餘 loader（`getAdherenceSummary`/`getAllAlertsForResearcher`/`getUnreviewedChats`/`getAllReportsForResearcher`）回傳空陣列。

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd prototype && npx vitest run src/pages/__tests__/ResearcherDashboard.test.jsx -t "導覽到該病人詳情"`
Expected: FAIL（列不可點，路徑未變）。

- [ ] **Step 3: 最小實作 — 列可點 + 鍵盤可操作**

`ResearcherDashboard.jsx` 的 `cohort-row`（約 729 行）加上導覽與無障礙屬性，且僅在 `!isDemo` 時可點：

```jsx
<div key={row.study_id} className="cohort-row" data-tone={tone}
  role={!isDemo ? 'button' : undefined}
  tabIndex={!isDemo ? 0 : undefined}
  style={{ cursor: !isDemo ? 'pointer' : undefined }}
  onClick={!isDemo ? () => navigate(`/lookup/${row.study_id}`) : undefined}
  onKeyDown={!isDemo ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/lookup/${row.study_id}`); } } : undefined}
>
```

同一列內既有的「撰寫手術紀錄」按鈕，`onClick` 加 `stopPropagation`，避免點按鈕誤觸整列導覽：

```jsx
onClick={(e) => { e.stopPropagation(); navigate(`/surgical-record/${row.study_id}`); }}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd prototype && npx vitest run src/pages/__tests__/ResearcherDashboard.test.jsx`
Expected: PASS（含新測試，且既有測試不回歸）。

- [ ] **Step 5: 全套測試 + lint**

Run: `cd prototype && npx vitest run && npx eslint src/pages/ResearcherPatientLookup.jsx src/pages/ResearcherDashboard.jsx src/App.jsx`
Expected: 全綠、無 lint 錯誤。

- [ ] **Step 6: Commit**

```bash
cd "/Users/huangshifeng/Desktop/Research/AI_Clinical/痔瘡AI衛教"
git add prototype/src/pages/ResearcherDashboard.jsx prototype/src/pages/__tests__/ResearcherDashboard.test.jsx
git commit -m "$(cat <<'EOF'
feat(researcher): make cohort rows link into per-patient detail

Clicking (or Enter/Space on) a cohort row opens /lookup/:studyId; the
surgical-record button stops propagation so it still writes records.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015Z7mzDxTjjcoXW5Vpf6D5G
EOF
)"
```

---

## 部署（全部完成後、排傍晚）

- [ ] 確認 `cd prototype && npx vitest run` 全綠、`npm run build` 成功。
- [ ] 依 [[no-deploy-during-enrolment]] 排傍晚/深夜部署前端（Vercel）。
- [ ] 部署後以 test 帳號（[[e2e-test-account]]）登入研究者端，點 cohort 列 → 確認趨勢圖與逐日明細正常。

## Self-Review

- **Spec coverage**：逐日明細（Task 1）、疼痛趨勢（Task 2）、路由自動載入（Task 3）、cohort 可點（Task 4）、唯讀（Task 1 無編輯鈕）、空狀態（Task 1）、不碰 History（趨勢圖為頁內自帶 `PatientPainTrend`）、測試（各 Task 均含）、部署排傍晚（部署段）——皆有對應。
- **Placeholder scan**：無 TBD/TODO；所有步驟含實際程式碼。
- **Type consistency**：`result.reports` 於 Task 1 產生、Task 2 消費；`runLookup(studyId)` 於 Task 3 定義並被 `handleLookup` 與 `useEffect` 呼叫；`/lookup/:studyId` 路由於 Task 3 建立、Task 4 導覽至此——名稱一致。
