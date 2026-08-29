# CRF 自動填寫 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 CRF 工作簿的可推導欄位由腳本從 Dashboard 的完整備份 JSON 填入，人只填簽名、納排條件與臨床判讀。

**Architecture:** 資料只走一條既有路徑。先把研究人員 Dashboard 的「完整備份」從 4 張表擴到 8 張，再寫一支本機 Python 腳本吃那份 JSON，就地更新 CRF 工作簿的自動欄。腳本不連資料庫、不持有金鑰。另外補上 `healthcare_utilization` 缺的 insert 路徑，該表至今沒有任何寫入端。

**Tech Stack:** React 18 + Vite（前端）、Vitest（前端測試）、Supabase JS v2、Python 3 + openpyxl（腳本）、unittest（腳本測試）

**Spec:** `docs/superpowers/specs/2026-08-29-crf-export-design.md`

## Global Constraints

- 收案進行中，production 上有真實病人。**不得新增任何 DDL**（`CREATE`/`ALTER`/`DROP`），不得對 production 執行 `supabase db push`。
- Repo 是 PUBLIC。受試者姓名、病歷號、email、電話、任何金鑰都不得寫入任何檔案，包含測試 fixture。只以 Study ID 指涉。
- Commit 時逐一 stage，不得從根目錄 `git add -A`。
- CRF 工作簿 `收案文件/個案報告表_CRF紀錄.xlsx` 已被 `.gitignore:40` 的 glob `收案文件/個案報告表*.xlsx` 涵蓋。備份檔沿用同一個開頭即自動不進版控。
- 前端經 Vercel git integration 部署，不等 CI；Edge Function 由根目錄 `.github/workflows/ci.yml` 末段部署。本計畫只動前端。
- 應回報數與依從率一律取 `v_adherence_summary`，不得在腳本內重算。回報日規則的單一定義是 `fn_report_days()`。
- 驗證前端是否上線要比對字串，不要比對 bundle hash。

---

### Task 1: 三個 researcher 全量讀取函式

`handleFullBackup` 需要的四份資料裡，`getAdherenceSummary()` 已存在，其餘三份沒有全量讀取函式。`getUtilization(studyId)` 只能單例查詢且零呼叫端。

**Files:**
- Modify: `prototype/src/utils/supabaseService.js`（在 `getAllChatsForResearcher()` 之後新增）
- Test: `prototype/src/utils/__tests__/supabaseServiceErrors.test.js`

**Interfaces:**
- Consumes: 既有的 `supabase` client 與 `logError`
- Produces: `getAllSurgicalRecordsForResearcher()`、`getAllSurveysForResearcher()`、`getAllUtilizationForResearcher()`，皆 `async`、無參數、回傳 `Promise<object[]>`，失敗時 `throw error`

- [ ] **Step 1: 讀既有樣式**

先讀 `prototype/src/utils/supabaseService.js` 裡的 `getAllAlertsForResearcher()`（約在 750 行）。三個新函式照它寫：失敗時 `console.error` + `logError` + `throw`，不要吞成空陣列。理由寫在該函式的註解裡：「0 筆」和「查詢失敗」在 PI 的總覽上不能長得一樣。

- [ ] **Step 2: 寫失敗的測試**

加到 `prototype/src/utils/__tests__/supabaseServiceErrors.test.js`。先讀該檔開頭的 mock 設定，沿用同一套。

```javascript
describe('researcher 全量讀取：失敗要 throw，不要吞成空陣列', () => {
  it.each([
    ['getAllSurgicalRecordsForResearcher', 'surgical_records'],
    ['getAllSurveysForResearcher', 'usability_surveys'],
    ['getAllUtilizationForResearcher', 'healthcare_utilization'],
  ])('%s 在 Supabase 回錯時 throw', async (fnName, table) => {
    mockSupabaseError(table, { message: 'permission denied' });
    const sb = await import('../supabaseService');
    await expect(sb[fnName]()).rejects.toThrow('permission denied');
  });

  it.each([
    ['getAllSurgicalRecordsForResearcher', 'surgical_records'],
    ['getAllSurveysForResearcher', 'usability_surveys'],
    ['getAllUtilizationForResearcher', 'healthcare_utilization'],
  ])('%s 成功時回傳資料列', async (fnName, table) => {
    mockSupabaseData(table, [{ study_id: 'TEST-001' }]);
    const sb = await import('../supabaseService');
    await expect(sb[fnName]()).resolves.toEqual([{ study_id: 'TEST-001' }]);
  });
});
```

若該測試檔的既有 helper 不叫 `mockSupabaseError` / `mockSupabaseData`，改用檔案裡實際的名字，不要新增第二套 mock。

- [ ] **Step 3: 執行測試確認失敗**

Run: `cd prototype && npx vitest run src/utils/__tests__/supabaseServiceErrors.test.js`
Expected: FAIL，訊息類似 `sb.getAllSurgicalRecordsForResearcher is not a function`

- [ ] **Step 4: 實作三個函式**

```javascript
export async function getAllSurgicalRecordsForResearcher() {
  const { data, error } = await supabase
    .from('surgical_records')
    .select('*')
    .order('study_id', { ascending: true });
  // RLS 是 researcher_read_own_surgeon：非 PI 帳號只讀得到自己的刀。
  // 少列不會報錯，只會少列——涵蓋率由 crf_fill.py 在寫檔前擋。
  if (error) {
    console.error('[getAllSurgicalRecordsForResearcher]', error.message);
    logError(error, { type: 'supabase_read', component: 'getAllSurgicalRecordsForResearcher' });
    throw error;
  }
  return data || [];
}

export async function getAllSurveysForResearcher() {
  const { data, error } = await supabase
    .from('usability_surveys')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[getAllSurveysForResearcher]', error.message);
    logError(error, { type: 'supabase_read', component: 'getAllSurveysForResearcher' });
    throw error;
  }
  return data || [];
}

export async function getAllUtilizationForResearcher() {
  const { data, error } = await supabase
    .from('healthcare_utilization')
    .select('*')
    .order('event_date', { ascending: false });
  if (error) {
    console.error('[getAllUtilizationForResearcher]', error.message);
    logError(error, { type: 'supabase_read', component: 'getAllUtilizationForResearcher' });
    throw error;
  }
  return data || [];
}
```

- [ ] **Step 5: 執行測試確認通過**

Run: `cd prototype && npx vitest run src/utils/__tests__/supabaseServiceErrors.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd "/Users/huangshifeng/Desktop/Research/AI_Clinical/痔瘡AI衛教"
git add prototype/src/utils/supabaseService.js prototype/src/utils/__tests__/supabaseServiceErrors.test.js
git commit -m "feat(researcher): add full-table readers for surgical records, surveys and utilization"
```

---

### Task 2: 完整備份從 4 張表擴到 8 張

**Files:**
- Modify: `prototype/src/pages/ResearcherDashboard.jsx:283-303`（`handleFullBackup`）
- Modify: `prototype/src/utils/schemaContract.js`（新增 `FULL_BACKUP_TABLES`）
- Test: `prototype/src/utils/__tests__/schemaAlignment.test.js`

**Interfaces:**
- Consumes: Task 1 的 `getAllSurgicalRecordsForResearcher()`、`getAllSurveysForResearcher()`、`getAllUtilizationForResearcher()`；既有的 `getAdherenceSummary()`
- Produces: 備份 JSON 的頂層鍵固定為 `FULL_BACKUP_TABLES` 這 8 個字串，`crf_fill.py` 依賴這組鍵名

- [ ] **Step 1: 寫失敗的測試**

加到 `prototype/src/utils/__tests__/schemaAlignment.test.js`。沿用該檔既有的 `readSrc()` 讀原始碼字串的做法。

```javascript
import { FULL_BACKUP_TABLES } from '../schemaContract';

describe('完整備份涵蓋 CRF 需要的每一張表', () => {
  it('FULL_BACKUP_TABLES 就是 CRF 需要的 8 份', () => {
    expect([...FULL_BACKUP_TABLES].sort()).toEqual([
      'adherence_summary', 'ai_chat_logs', 'alerts', 'healthcare_utilization',
      'patients', 'surgical_records', 'symptom_reports', 'usability_surveys',
    ]);
  });

  it('handleFullBackup 每一張表都真的放進 data 物件', () => {
    const src = readSrc('src/pages/ResearcherDashboard.jsx');
    const backup = src.slice(src.indexOf('const handleFullBackup'));
    const body = backup.slice(0, backup.indexOf('\n  };'));
    for (const table of FULL_BACKUP_TABLES) {
      expect(body).toContain(`${table}:`);
    }
  });
});
```

第二個測試是這裡的關鍵：`FULL_BACKUP_TABLES` 自己列一份清單不算數，要證明 `handleFullBackup` 真的把每一張都塞進去了。少接一張表，備份不會報錯，CRF 只是那幾欄空白。

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd prototype && npx vitest run src/utils/__tests__/schemaAlignment.test.js`
Expected: FAIL，`FULL_BACKUP_TABLES` 未匯出

- [ ] **Step 3: 在 schemaContract.js 定義清單**

```javascript
/**
 * 完整備份（ResearcherDashboard 的 handleFullBackup）匯出的表。
 * crf_fill.py 依這組鍵名讀 JSON，改名要同步改腳本。
 */
export const FULL_BACKUP_TABLES = [
  'patients',
  'symptom_reports',
  'alerts',
  'ai_chat_logs',
  'surgical_records',
  'usability_surveys',
  'healthcare_utilization',
  'adherence_summary',
];
```

- [ ] **Step 4: 擴充 handleFullBackup**

把 `prototype/src/pages/ResearcherDashboard.jsx` 的 `handleFullBackup` 整段換成：

```javascript
  const handleFullBackup = async () => {
    setExporting(true); setExportType('backup');
    try {
      let data;
      if (isDemo) {
        const mock = getResearcherMockData();
        data = {
          patients: mock.patients, symptom_reports: mock.reports,
          alerts: mock.alerts, ai_chat_logs: mock.chatLogs,
          surgical_records: [], usability_surveys: [],
          healthcare_utilization: [], adherence_summary: [],
        };
      } else {
        const [reports, alertData, chats, pts, surg, surveys, hcu, adh] = await Promise.all([
          sb.getAllReportsForResearcher(),
          sb.getAllAlertsForResearcher(),
          sb.getAllChatsForResearcher(),
          sb.getAllPatients(),
          sb.getAllSurgicalRecordsForResearcher(),
          sb.getAllSurveysForResearcher(),
          sb.getAllUtilizationForResearcher(),
          sb.getAdherenceSummary(),
        ]);
        data = {
          patients: pts, symptom_reports: reports, alerts: alertData, ai_chat_logs: chats,
          surgical_records: surg, usability_surveys: surveys,
          healthcare_utilization: hcu, adherence_summary: adh,
        };
      }
      downloadJSON(data, `full_backup_${today}.json`);
    } catch (err) { alert('備份失敗：' + err.message); }
    finally { setExporting(false); setExportType(null); }
  };
```

demo 模式四張新表給空陣列：demo 資料沒有這些，塞假的會讓人以為 demo 能產 CRF。

- [ ] **Step 5: 執行測試確認通過**

Run: `cd prototype && npx vitest run src/utils/__tests__/schemaAlignment.test.js src/pages/__tests__/ResearcherDashboard.test.js`
Expected: PASS，且 `ResearcherDashboard.test.jsx` 既有測試不得轉紅

- [ ] **Step 6: 全套驗證並 commit**

```bash
cd prototype && npm run lint && npm test && npm run build
cd "/Users/huangshifeng/Desktop/Research/AI_Clinical/痔瘡AI衛教"
git add prototype/src/pages/ResearcherDashboard.jsx prototype/src/utils/schemaContract.js prototype/src/utils/__tests__/schemaAlignment.test.js
git commit -m "feat(researcher): widen the full backup to the eight tables the CRF needs"
```

---

### Task 3: healthcare_utilization 的 insert 路徑

該表有 schema、有 RLS policy、有讀取函式，就是沒有任何地方寫得進去。目前唯一一筆已知就醫事件只存在於收案對照表的備註欄。

**Files:**
- Modify: `prototype/src/utils/supabaseService.js`
- Modify: `prototype/src/pages/ResearcherPatientLookup.jsx`（在 `:344` 的「重設病人密碼」卡片之前插入）
- Test: `prototype/src/utils/__tests__/supabaseServiceErrors.test.js`、`prototype/src/pages/__tests__/ResearcherPatientLookup.test.jsx`

**Interfaces:**
- Consumes: 既有 `supabase` client
- Produces: `addUtilization({ studyId, eventType, eventDate, reason, podAtEvent })` → `Promise<void>`，失敗時 throw

- [ ] **Step 1: 寫失敗的測試（service 層）**

```javascript
describe('addUtilization', () => {
  it('寫入 healthcare_utilization 並留下 audit_trail', async () => {
    const inserts = captureInserts();
    const sb = await import('../supabaseService');
    await sb.addUtilization({
      studyId: 'TEST-001', eventType: '急診', eventDate: '2026-08-11',
      reason: '術後出血', podAtEvent: 6,
    });
    expect(inserts.healthcare_utilization[0]).toMatchObject({
      study_id: 'TEST-001', event_type: '急診', event_date: '2026-08-11',
      reason: '術後出血', pod_at_event: 6,
    });
    expect(inserts.audit_trail[0]).toMatchObject({
      action: 'utilization.add', resource: 'healthcare_utilization',
    });
  });

  it('Supabase 回錯時 throw', async () => {
    mockSupabaseError('healthcare_utilization', { message: 'permission denied' });
    const sb = await import('../supabaseService');
    await expect(sb.addUtilization({
      studyId: 'TEST-001', eventType: '急診', eventDate: '2026-08-11', reason: 'x', podAtEvent: 6,
    })).rejects.toThrow('permission denied');
  });
});
```

`captureInserts` 若該測試檔沒有，照檔案既有的 mock 風格加一個，不要引入新的 mock 框架。

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd prototype && npx vitest run src/utils/__tests__/supabaseServiceErrors.test.js -t addUtilization`
Expected: FAIL

- [ ] **Step 3: 實作 addUtilization**

放在 `getAllUtilizationForResearcher()` 之後：

```javascript
export async function addUtilization({ studyId, eventType, eventDate, reason, podAtEvent }) {
  const { error } = await supabase.from('healthcare_utilization').insert({
    study_id: studyId,
    event_type: eventType,
    event_date: eventDate,
    pod_at_event: podAtEvent,
    reason,
  });
  if (error) {
    console.error('[addUtilization]', error.message);
    throw error;
  }
  // 照 acknowledgeAlert 的做法：稽核是 best-effort，不能讓它擋掉主要寫入
  try {
    await supabase.from('audit_trail').insert({
      actor_role: 'researcher',
      action: 'utilization.add',
      resource: 'healthcare_utilization',
      resource_id: studyId,
    });
  } catch { /* best-effort */ }
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd prototype && npx vitest run src/utils/__tests__/supabaseServiceErrors.test.js -t addUtilization`
Expected: PASS

- [ ] **Step 5: 寫失敗的測試（UI 層）**

加到 `prototype/src/pages/__tests__/ResearcherPatientLookup.test.jsx`，沿用該檔既有的 render 與 mock 樣式：

```javascript
it('登錄就醫事件會呼叫 addUtilization 並帶入算好的 POD', async () => {
  const addUtilization = vi.fn().mockResolvedValue(undefined);
  renderLookupWith({ patient: { study_id: 'TEST-001', surgery_date: '2026-08-05' }, addUtilization });

  await userEvent.selectOptions(screen.getByLabelText('就醫類型'), '急診');
  await userEvent.type(screen.getByLabelText('就醫日期'), '2026-08-11');
  await userEvent.type(screen.getByLabelText('就醫原因'), '術後出血');
  await userEvent.click(screen.getByRole('button', { name: '登錄' }));

  expect(addUtilization).toHaveBeenCalledWith(expect.objectContaining({
    studyId: 'TEST-001', eventType: '急診', eventDate: '2026-08-11',
    reason: '術後出血', podAtEvent: 6,
  }));
});

it('缺就醫日期時按鈕不可按', async () => {
  renderLookupWith({ patient: { study_id: 'TEST-001', surgery_date: '2026-08-05' } });
  expect(screen.getByRole('button', { name: '登錄' })).toBeDisabled();
});
```

POD 由就醫日期減手術日期得出，不讓人手填，手填會出現跟症狀回報對不起來的 POD。

- [ ] **Step 6: 執行測試確認失敗**

Run: `cd prototype && npx vitest run src/pages/__tests__/ResearcherPatientLookup.test.jsx`
Expected: FAIL，找不到「就醫類型」

- [ ] **Step 7: 加登錄卡片**

在 `ResearcherPatientLookup.jsx` 的「重設病人密碼」卡片之前插入。state 加在該元件既有 state 之後：

```javascript
  const [hcuType, setHcuType] = useState('門診');
  const [hcuDate, setHcuDate] = useState('');
  const [hcuReason, setHcuReason] = useState('');
  const [hcuSaving, setHcuSaving] = useState(false);
  const [hcuMsg, setHcuMsg] = useState('');
```

卡片本體照 `:344` 那張「Admin Tool」的結構，`card-kicker` 改成 `Data Entry`、`card-title` 改成「登錄就醫事件」。表單三個欄位加 `<label>` 並以 `htmlFor` 綁定（測試靠 `getByLabelText` 找元素）：

```jsx
<button
  className="btn"
  disabled={!hcuDate || !hcuReason.trim() || hcuSaving}
  onClick={async () => {
    setHcuSaving(true); setHcuMsg('');
    try {
      const pod = Math.floor(
        (Date.parse(`${hcuDate}T00:00:00Z`) - Date.parse(`${result.patient.surgery_date}T00:00:00Z`))
        / 86400000
      );
      await sb.addUtilization({
        studyId: result.studyId, eventType: hcuType, eventDate: hcuDate,
        reason: hcuReason.trim(), podAtEvent: pod,
      });
      setHcuMsg('已登錄'); setHcuDate(''); setHcuReason('');
    } catch (err) {
      setHcuMsg('登錄失敗：' + err.message);
    } finally {
      setHcuSaving(false);
    }
  }}
>登錄</button>
```

就醫類型的選項用 `<option>` 列出：門診、急診、再住院、電話諮詢。這四個要與 CRF `表單四` 的「就醫類型」欄位用語一致，腳本是原字串寫入，不做對照。

- [ ] **Step 8: 執行測試確認通過**

Run: `cd prototype && npx vitest run src/pages/__tests__/ResearcherPatientLookup.test.jsx`
Expected: PASS

- [ ] **Step 9: 全套驗證並 commit**

```bash
cd prototype && npm run lint && npm test && npm run build
cd "/Users/huangshifeng/Desktop/Research/AI_Clinical/痔瘡AI衛教"
git add prototype/src/utils/supabaseService.js prototype/src/pages/ResearcherPatientLookup.jsx prototype/src/utils/__tests__/supabaseServiceErrors.test.js prototype/src/pages/__tests__/ResearcherPatientLookup.test.jsx
git commit -m "feat(researcher): give healthcare_utilization a write path"
```

---

### Task 4: crf_fill.py 的基礎與涵蓋率檢查

先把「讀 JSON、驗涵蓋率、備份工作簿、依鍵對位」這幾件事做出來並測到，再碰任何一個分頁。

**Files:**
- Create: `prototype/scripts/crf_fill.py`
- Create: `prototype/scripts/test_crf_fill.py`

**Interfaces:**
- Produces:
  - `load_backup(path=None) -> dict` — `path` 為 `None` 時取 `~/Downloads/` 裡 mtime 最新的 `full_backup_*.json`
  - `check_coverage(backup) -> list[str]` — 回傳缺手術記錄的 study_id 清單，全齊時回空 list
  - `norm_date(value) -> str | None` — 把 ISO 字串、`datetime`、`date` 一律正規化成 `YYYY-MM-DD`
  - `header_map(ws, header_row) -> dict[str, int]` — 欄名對到 1-based 欄號
  - `backup_workbook(path) -> pathlib.Path` — 複製成 `.bak-YYYYMMDD.xlsx` 並回傳新路徑
  - `CrfError(Exception)` — 中止用的例外

- [ ] **Step 1: 寫失敗的測試**

```python
import json, unittest, tempfile, pathlib
from datetime import date, datetime
import openpyxl
import crf_fill


class TestNormDate(unittest.TestCase):
    def test_accepts_iso_string_with_time(self):
        self.assertEqual(crf_fill.norm_date('2026-08-11T09:30:00+00:00'), '2026-08-11')

    def test_accepts_plain_date_string(self):
        self.assertEqual(crf_fill.norm_date('2026-08-11'), '2026-08-11')

    def test_accepts_excel_datetime(self):
        self.assertEqual(crf_fill.norm_date(datetime(2026, 8, 11, 0, 0)), '2026-08-11')

    def test_accepts_date(self):
        self.assertEqual(crf_fill.norm_date(date(2026, 8, 11)), '2026-08-11')

    def test_blank_is_none(self):
        self.assertIsNone(crf_fill.norm_date(None))
        self.assertIsNone(crf_fill.norm_date(''))


class TestCoverage(unittest.TestCase):
    def _backup(self, patients, surgical):
        return {'patients': patients, 'surgical_records': surgical}

    def test_all_covered_returns_empty(self):
        b = self._backup(
            [{'study_id': 'AAA-001'}, {'study_id': 'AAA-002'}],
            [{'study_id': 'AAA-001'}, {'study_id': 'AAA-002'}],
        )
        self.assertEqual(crf_fill.check_coverage(b), [])

    def test_missing_surgical_record_is_reported(self):
        b = self._backup(
            [{'study_id': 'AAA-001'}, {'study_id': 'AAA-002'}],
            [{'study_id': 'AAA-001'}],
        )
        self.assertEqual(crf_fill.check_coverage(b), ['AAA-002'])

    def test_test_account_is_exempt(self):
        b = self._backup([{'study_id': 'TEST-001'}, {'study_id': 'AAA-001'}],
                         [{'study_id': 'AAA-001'}])
        self.assertEqual(crf_fill.check_coverage(b), [])


class TestHeaderMap(unittest.TestCase):
    def test_maps_names_to_one_based_columns(self):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws['A4'], ws['B4'], ws['C4'] = 'Study ID', '收案日期', '年齡'
        self.assertEqual(crf_fill.header_map(ws, 4),
                         {'Study ID': 1, '收案日期': 2, '年齡': 3})


class TestLoadBackup(unittest.TestCase):
    def test_picks_newest_when_no_path_given(self):
        with tempfile.TemporaryDirectory() as d:
            old = pathlib.Path(d) / 'full_backup_2026-08-01.json'
            new = pathlib.Path(d) / 'full_backup_2026-08-29.json'
            old.write_text(json.dumps({'patients': [{'study_id': 'OLD'}]}))
            new.write_text(json.dumps({'patients': [{'study_id': 'NEW'}]}))
            import os
            os.utime(old, (1, 1))
            got = crf_fill.load_backup(search_dir=pathlib.Path(d))
            self.assertEqual(got['patients'][0]['study_id'], 'NEW')

    def test_no_backup_found_raises(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(crf_fill.CrfError):
                crf_fill.load_backup(search_dir=pathlib.Path(d))


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd prototype/scripts && /usr/local/bin/python3 -m unittest test_crf_fill -v`
Expected: FAIL，`ModuleNotFoundError: No module named 'crf_fill'`

註：`/usr/bin/python3`（3.9.6）沒有 openpyxl，`/usr/local/bin/python3`（3.13）有。腳本與測試都用後者。

- [ ] **Step 3: 實作基礎函式**

```python
#!/usr/bin/env python3
"""把研究人員 Dashboard 的完整備份填進 CRF 工作簿的自動欄。

自動欄每次覆寫，手填欄永不觸碰——某欄是不是自動欄，看它有沒有出現在 AUTO 裡。
設計理由與欄位分類見 docs/superpowers/specs/2026-08-29-crf-export-design.md。
"""
import json
import shutil
import sys
from copy import copy
from datetime import date, datetime
from pathlib import Path

import openpyxl

CRF_PATH = Path(__file__).resolve().parents[2] / '收案文件' / '個案報告表_CRF紀錄.xlsx'
TEST_PREFIX = 'TEST-'


class CrfError(Exception):
    """中止用。訊息會直接印給操作者看，寫人話。"""


def norm_date(value):
    """ISO 字串、datetime、date 一律正規化成 YYYY-MM-DD。

    對位鍵兩端一邊來自 JSON（字串）、一邊來自 Excel（datetime），
    不正規化就永遠對不上，結果是每次執行都新增重複列。
    """
    if value is None or value == '':
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)[:10]


def load_backup(path=None, search_dir=None):
    if path:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    search_dir = search_dir or Path.home() / 'Downloads'
    candidates = sorted(search_dir.glob('full_backup_*.json'),
                        key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        raise CrfError(
            f'在 {search_dir} 找不到 full_backup_*.json。\n'
            '請先到研究人員 Dashboard 按「完整備份」下載一份。'
        )
    return json.loads(candidates[0].read_text(encoding='utf-8'))


def check_coverage(backup):
    """回傳缺手術記錄的 study_id。

    surgical_records 的 RLS 是 researcher_read_own_surgeon：非 PI 帳號下載的備份
    只有自己的刀。少的那幾列在 CRF 裡看起來就只是空白，所以寧可中止。
    """
    subjects = {p['study_id'] for p in backup.get('patients', [])
                if not p['study_id'].startswith(TEST_PREFIX)}
    have = {r['study_id'] for r in backup.get('surgical_records', [])}
    return sorted(subjects - have)


def header_map(ws, header_row):
    return {cell.value: cell.column
            for cell in ws[header_row] if cell.value is not None}


def backup_workbook(path):
    dest = path.with_name(f"{path.stem}.bak-{datetime.now():%Y%m%d}{path.suffix}")
    shutil.copy2(path, dest)
    return dest
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd prototype/scripts && /usr/local/bin/python3 -m unittest test_crf_fill -v`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
cd "/Users/huangshifeng/Desktop/Research/AI_Clinical/痔瘡AI衛教"
git add prototype/scripts/crf_fill.py prototype/scripts/test_crf_fill.py
git commit -m "feat(crf): load the backup, verify surgical-record coverage, snapshot the workbook"
```

---

### Task 5: 依鍵對位的 upsert

這是整支腳本唯一會弄壞資料的地方。手填欄靠「不在 AUTO 裡就不寫」保護，列的身分靠對位鍵而不是列號。

**Files:**
- Modify: `prototype/scripts/crf_fill.py`
- Modify: `prototype/scripts/test_crf_fill.py`

**Interfaces:**
- Consumes: Task 4 的 `header_map`、`norm_date`
- Produces: `upsert_sheet(ws, header_row, key_cols, records, auto_map) -> int`（回傳寫入列數）。`key_cols` 是欄名 tuple；`auto_map` 是 `{欄名: callable(record) -> value}`

- [ ] **Step 1: 寫失敗的測試**

```python
class TestUpsert(unittest.TestCase):
    def _sheet(self):
        wb = openpyxl.Workbook()
        ws = wb.active
        for col, name in enumerate(['Study ID', '回報日期', '疼痛 NRS', '備註'], start=1):
            ws.cell(row=5, column=col).value = name
        return ws

    AUTO = {
        'Study ID': lambda r: r['study_id'],
        '回報日期': lambda r: crf_fill.norm_date(r['report_date']),
        '疼痛 NRS': lambda r: r['pain_nrs'],
    }
    KEY = ('Study ID', '回報日期')

    def test_inserts_new_rows(self):
        ws = self._sheet()
        crf_fill.upsert_sheet(ws, 5, self.KEY, [
            {'study_id': 'AAA-001', 'report_date': '2026-08-11', 'pain_nrs': 3},
        ], self.AUTO)
        self.assertEqual(ws.cell(row=6, column=1).value, 'AAA-001')
        self.assertEqual(ws.cell(row=6, column=3).value, 3)

    def test_manual_column_survives_rerun(self):
        ws = self._sheet()
        rec = {'study_id': 'AAA-001', 'report_date': '2026-08-11', 'pain_nrs': 3}
        crf_fill.upsert_sheet(ws, 5, self.KEY, [rec], self.AUTO)
        ws.cell(row=6, column=4).value = '主持人判讀為傷口分泌物'
        rec['pain_nrs'] = 5
        crf_fill.upsert_sheet(ws, 5, self.KEY, [rec], self.AUTO)
        self.assertEqual(ws.cell(row=6, column=3).value, 5)
        self.assertEqual(ws.cell(row=6, column=4).value, '主持人判讀為傷口分泌物')

    def test_manual_column_follows_its_own_row_when_order_changes(self):
        """新資料插進來導致列序改變時，備註不能接到別人身上。"""
        ws = self._sheet()
        later = {'study_id': 'AAA-001', 'report_date': '2026-08-11', 'pain_nrs': 3}
        crf_fill.upsert_sheet(ws, 5, self.KEY, [later], self.AUTO)
        ws.cell(row=6, column=4).value = '屬於 08-11 的備註'
        earlier = {'study_id': 'AAA-001', 'report_date': '2026-08-09', 'pain_nrs': 7}
        crf_fill.upsert_sheet(ws, 5, self.KEY, [earlier, later], self.AUTO)
        rows = {ws.cell(row=r, column=2).value: r for r in (6, 7)}
        self.assertEqual(ws.cell(row=rows['2026-08-11'], column=4).value, '屬於 08-11 的備註')
        self.assertIsNone(ws.cell(row=rows['2026-08-09'], column=4).value)

    def test_excel_datetime_key_matches_json_string(self):
        ws = self._sheet()
        ws.cell(row=6, column=1).value = 'AAA-001'
        ws.cell(row=6, column=2).value = datetime(2026, 8, 11)
        ws.cell(row=6, column=4).value = '既有備註'
        crf_fill.upsert_sheet(ws, 5, self.KEY, [
            {'study_id': 'AAA-001', 'report_date': '2026-08-11T00:00:00+00:00', 'pain_nrs': 9},
        ], self.AUTO)
        self.assertIsNone(ws.cell(row=7, column=1).value)  # 沒有新增重複列
        self.assertEqual(ws.cell(row=6, column=3).value, 9)
        self.assertEqual(ws.cell(row=6, column=4).value, '既有備註')

    def test_new_row_copies_style_from_previous_row(self):
        ws = self._sheet()
        crf_fill.upsert_sheet(ws, 5, self.KEY, [
            {'study_id': 'AAA-001', 'report_date': '2026-08-09', 'pain_nrs': 1},
        ], self.AUTO)
        ws.cell(row=6, column=1).font = openpyxl.styles.Font(bold=True, size=13)
        crf_fill.upsert_sheet(ws, 5, self.KEY, [
            {'study_id': 'AAA-001', 'report_date': '2026-08-09', 'pain_nrs': 1},
            {'study_id': 'AAA-002', 'report_date': '2026-08-09', 'pain_nrs': 2},
        ], self.AUTO)
        self.assertTrue(ws.cell(row=7, column=1).font.bold)
        self.assertEqual(ws.cell(row=7, column=1).font.size, 13)
```

第三個測試是這裡真正要防的東西。靠列號對位的實作在前兩個測試也會過，只有在插入較早日期、列序改變時才會把備註接到別人身上。

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd prototype/scripts && /usr/local/bin/python3 -m unittest test_crf_fill.TestUpsert -v`
Expected: FAIL，`module 'crf_fill' has no attribute 'upsert_sheet'`

- [ ] **Step 3: 實作 upsert_sheet**

```python
def _row_key(ws, row, idx, key_cols):
    parts = []
    for name in key_cols:
        raw = ws.cell(row=row, column=idx[name]).value
        parts.append(norm_date(raw) if '日期' in name or '時間' in name else raw)
    return tuple(parts)


def _first_blank_row(ws, header_row, idx, key_cols):
    first_key_col = idx[key_cols[0]]
    row = header_row + 1
    while ws.cell(row=row, column=first_key_col).value not in (None, ''):
        row += 1
    return row


def upsert_sheet(ws, header_row, key_cols, records, auto_map):
    """把 records 寫進 ws，自動欄覆寫、其餘欄不動。

    對位靠 key_cols 組成的鍵，不靠列號——列序會因新資料而改變，
    靠列號會把手填的備註接到別人的資料上。
    """
    idx = header_map(ws, header_row)
    missing = [c for c in list(key_cols) + list(auto_map) if c not in idx]
    if missing:
        raise CrfError(f'{ws.title} 找不到欄位：{"、".join(missing)}')

    existing = {}
    for row in range(header_row + 1, ws.max_row + 1):
        key = _row_key(ws, row, idx, key_cols)
        if key[0] not in (None, ''):
            existing[key] = row

    written = 0
    for rec in records:
        key = tuple(
            norm_date(auto_map[name](rec)) if '日期' in name or '時間' in name
            else auto_map[name](rec)
            for name in key_cols
        )
        row = existing.get(key)
        if row is None:
            row = _first_blank_row(ws, header_row, idx, key_cols)
            if row > header_row + 1:
                for col in range(1, ws.max_column + 1):
                    ws.cell(row=row, column=col)._style = copy(
                        ws.cell(row=row - 1, column=col)._style)
            existing[key] = row
        for name, fn in auto_map.items():
            ws.cell(row=row, column=idx[name]).value = fn(rec)
        written += 1
    return written
```

`_style` 要整列複製，只設 font 會漏掉 alignment、border、fill。此坑見 `研究日誌/2026-08-13.yaml`。

- [ ] **Step 4: 執行測試確認通過**

Run: `cd prototype/scripts && /usr/local/bin/python3 -m unittest test_crf_fill -v`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
cd "/Users/huangshifeng/Desktop/Research/AI_Clinical/痔瘡AI衛教"
git add prototype/scripts/crf_fill.py prototype/scripts/test_crf_fill.py
git commit -m "feat(crf): upsert rows by join key so hand-entered columns keep their row"
```

---

### Task 6: 六個分頁的欄位對映

**Files:**
- Modify: `prototype/scripts/crf_fill.py`
- Modify: `prototype/scripts/test_crf_fill.py`

**Interfaces:**
- Consumes: Task 5 的 `upsert_sheet`
- Produces: `SHEETS` — `{分頁名: {'header_row': int, 'key': tuple, 'source': str, 'auto': dict}}`；`build_context(backup) -> dict` 供 lambda 取用跨表資料

- [ ] **Step 1: 寫失敗的測試**

```python
class TestSheetMapping(unittest.TestCase):
    FORMULA_COLUMNS = {
        '個案總覽': ['POD（今日）', '依從率'],
        '表單六_結案退出': ['依從率'],
    }
    MANUAL_COLUMNS = {
        '表單一_收案登記': ['年齡', '性別', 'BMI', '納入條件全符合', '排除條件皆無',
                            '補助費 NT$300', '研究人員簽名', '備註'],
        '表單三_警示處理紀錄': ['處理方式', '處理結果', '是否為假陽性', '處理人員', '處理日期'],
        '表單四_醫療利用紀錄': ['記錄人員'],
        '表單六_結案退出': ['退出原因', '備註', '研究人員簽名'],
        '個案總覽': ['備註'],
        '表單二_每日症狀回報': ['備註'],
    }

    def test_no_manual_column_is_ever_automated(self):
        for sheet, manual in self.MANUAL_COLUMNS.items():
            auto = set(crf_fill.SHEETS[sheet]['auto'])
            self.assertEqual(auto & set(manual), set(),
                             f'{sheet} 把手填欄列成自動欄')

    def test_formula_columns_are_never_written(self):
        for sheet, formulas in self.FORMULA_COLUMNS.items():
            auto = set(crf_fill.SHEETS[sheet]['auto'])
            self.assertEqual(auto & set(formulas), set(),
                             f'{sheet} 會把公式覆寫成靜態值')

    def test_app_registration_does_not_read_app_activated(self):
        """app_activated 是死欄位，11 例全 false，拿它判定會全部填成「否」。"""
        src = (pathlib.Path(crf_fill.__file__)).read_text(encoding='utf-8')
        self.assertNotIn('app_activated', src)

    def test_adherence_comes_from_the_view(self):
        auto = crf_fill.SHEETS['個案總覽']['auto']
        ctx = crf_fill.build_context({
            'patients': [{'study_id': 'AAA-001', 'surgery_date': '2026-08-01',
                          'created_at': '2026-07-31T02:00:00+00:00', 'study_status': 'active'}],
            'adherence_summary': [{'study_id': 'AAA-001', 'expected_reports': 9, 'total_reports': 8}],
            'symptom_reports': [], 'alerts': [], 'ai_chat_logs': [],
            'usability_surveys': [], 'surgical_records': [], 'healthcare_utilization': [],
        })
        rec = ctx['overview'][0]
        self.assertEqual(auto['應回報數'](rec), 9)
```

`test_app_registration_does_not_read_app_activated` 是文字比對，看起來粗糙，但它擋的是這個 repo 已經踩過四次的同一件事：讀一個沒有寫入端的欄位，結果全部填成預設值而且沒有人發現。

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd prototype/scripts && /usr/local/bin/python3 -m unittest test_crf_fill.TestSheetMapping -v`
Expected: FAIL，`module 'crf_fill' has no attribute 'SHEETS'`

- [ ] **Step 3: 實作 build_context 與 SHEETS**

```python
STATUS_LABEL = {'active': '追蹤中', 'completed': '已完成', 'withdrawn': '已退出'}


def build_context(backup):
    """把備份攤平成每個分頁要的記錄，跨表資料先併好，lambda 裡不再查表。"""
    by_id = {p['study_id']: p for p in backup['patients']
             if not p['study_id'].startswith(TEST_PREFIX)}
    adh = {a['study_id']: a for a in backup.get('adherence_summary', [])}
    surg = {s['study_id']: s for s in backup.get('surgical_records', [])}
    surveys = {s['study_id']: s for s in backup.get('usability_surveys', [])}

    def counted(rows, sid):
        return sum(1 for r in rows if r.get('study_id') == sid)

    reports = [r for r in backup.get('symptom_reports', []) if r['study_id'] in by_id]
    alerts = [a for a in backup.get('alerts', []) if a['study_id'] in by_id]
    hcu = [h for h in backup.get('healthcare_utilization', []) if h['study_id'] in by_id]
    chats = backup.get('ai_chat_logs', [])

    overview = []
    for seq, (sid, p) in enumerate(
            sorted(by_id.items(), key=lambda kv: norm_date(kv[1].get('created_at')) or ''), start=1):
        overview.append({
            'seq': seq, 'patient': p, 'study_id': sid,
            'adherence': adh.get(sid, {}), 'surgical': surg.get(sid, {}),
            'survey': surveys.get(sid),
            'n_reports': counted(reports, sid),
            'n_alerts': counted(alerts, sid),
            'n_unacked': sum(1 for a in alerts
                             if a['study_id'] == sid and not a.get('acknowledged')),
            'n_chats': counted(chats, sid),
        })

    def pod_of(sid, when):
        surgery = norm_date(by_id[sid].get('surgery_date'))
        if not surgery or not when:
            return None
        return (date.fromisoformat(norm_date(when)) - date.fromisoformat(surgery)).days

    return {
        'overview': overview,
        'reports': reports,
        'alerts': [dict(a, _pod=pod_of(a['study_id'], a.get('triggered_at'))) for a in alerts],
        'hcu': hcu,
        'closed': [o for o in overview
                   if o['patient'].get('study_status') in ('completed', 'withdrawn')],
    }


SHEETS = {
    '個案總覽': {
        'header_row': 4, 'key': ('Study ID',), 'source': 'overview',
        'auto': {
            '序號': lambda r: r['seq'],
            'Study ID': lambda r: r['study_id'],
            '主刀醫師': lambda r: r['patient'].get('surgeon_id'),
            '手術日期': lambda r: norm_date(r['patient'].get('surgery_date')),
            '收案日期': lambda r: norm_date(r['patient'].get('created_at')),
            '實際回報數': lambda r: r['n_reports'],
            '應回報數': lambda r: r['adherence'].get('expected_reports'),
            'AI 衛教使用次數': lambda r: r['n_chats'],
            '警示總數': lambda r: r['n_alerts'],
            '未確認警示': lambda r: r['n_unacked'],
            '可用性問卷': lambda r: '已完成' if r['survey'] else '未完成',
            '收案狀態': lambda r: STATUS_LABEL.get(r['patient'].get('study_status'), '追蹤中'),
        },
    },
    '表單一_收案登記': {
        'header_row': 4, 'key': ('Study ID',), 'source': 'overview',
        'auto': {
            'Study ID': lambda r: r['study_id'],
            '收案日期': lambda r: norm_date(r['patient'].get('created_at')),
            '痔瘡分級': lambda r: r['surgical'].get('hemorrhoid_grade'),
            '手術日期': lambda r: norm_date(r['patient'].get('surgery_date')),
            '術式': lambda r: r['surgical'].get('procedure_type'),
            '縫合方式': lambda r: r['surgical'].get('hemorrhoidectomy_subtype'),
            '能量器械': lambda r: '、'.join(r['surgical'].get('energy_device') or []) or '無',
            '麻醉方式': lambda r: r['surgical'].get('anesthesia_type'),
            '主刀醫師': lambda r: r['patient'].get('surgeon_id'),
            '同意書簽署日': lambda r: norm_date(r['patient'].get('consent_date')),
            # patients 有這一列即代表註冊完成。不讀那個沒有寫入端的布林欄位。
            'App 註冊完成': lambda r: '是',
        },
    },
    '表單二_每日症狀回報': {
        'header_row': 5, 'key': ('Study ID', '回報日期'), 'source': 'reports',
        'auto': {
            'Study ID': lambda r: r['study_id'],
            '回報日期': lambda r: norm_date(r['report_date']),
            'POD': lambda r: r.get('pod'),
            '疼痛 NRS': lambda r: r.get('pain_nrs'),
            '出血程度': lambda r: r.get('bleeding'),
            '排便狀況': lambda r: r.get('bowel'),
            '肛門控制': lambda r: r.get('continence'),
            '發燒': lambda r: r.get('fever'),
            '排尿狀況': lambda r: r.get('urinary'),
            '傷口狀況（可複選）': lambda r: '、'.join(r.get('wound') or []),
            '資料來源': lambda r: r.get('report_source'),
        },
    },
    '表單三_警示處理紀錄': {
        'header_row': 4, 'key': ('Study ID', '警示日期'), 'source': 'alerts',
        'auto': {
            'Study ID': lambda r: r['study_id'],
            '警示日期': lambda r: norm_date(r.get('triggered_at')),
            'POD': lambda r: r.get('_pod'),
            '警示類型': lambda r: r.get('alert_type'),
            '警示等級': lambda r: r.get('alert_level'),
        },
    },
    '表單四_醫療利用紀錄': {
        'header_row': 4, 'key': ('Study ID', '就醫日期'), 'source': 'hcu',
        'auto': {
            'Study ID': lambda r: r['study_id'],
            '就醫日期': lambda r: norm_date(r.get('event_date')),
            'POD': lambda r: r.get('pod_at_event'),
            '就醫類型': lambda r: r.get('event_type'),
            '就醫原因': lambda r: r.get('reason'),
        },
    },
    '表單六_結案退出': {
        'header_row': 4, 'key': ('Study ID',), 'source': 'closed',
        'auto': {
            'Study ID': lambda r: r['study_id'],
            '結案狀態': lambda r: STATUS_LABEL.get(r['patient'].get('study_status')),
            '結案/退出日期': lambda r: norm_date(r['patient'].get('completed_at')),
            'POD': lambda r: r['adherence'].get('max_pod'),
            '總回報次數': lambda r: r['n_reports'],
            '預期次數': lambda r: r['adherence'].get('expected_reports'),
            'AI 衛教使用次數': lambda r: r['n_chats'],
            '可用性問卷': lambda r: '已完成' if r['survey'] else '未完成',
        },
    },
}
```

`資料澄清註記` 不在 `SHEETS` 裡，全部欄位都是臨床判讀，腳本不碰。

- [ ] **Step 4: 執行測試確認通過**

Run: `cd prototype/scripts && /usr/local/bin/python3 -m unittest test_crf_fill -v`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
cd "/Users/huangshifeng/Desktop/Research/AI_Clinical/痔瘡AI衛教"
git add prototype/scripts/crf_fill.py prototype/scripts/test_crf_fill.py
git commit -m "feat(crf): map the six derivable sheets, leaving manual and formula columns alone"
```

---

### Task 7: main()、實跑與研究日誌

**Files:**
- Modify: `prototype/scripts/crf_fill.py`
- Modify: `prototype/scripts/test_crf_fill.py`
- Create: `研究日誌/2026-08-29.yaml`（若當日檔案已存在則附加對應區段）

**Interfaces:**
- Consumes: Task 4–6 的全部
- Produces: CLI 進入點 `python3 crf_fill.py [backup.json]`

- [ ] **Step 1: 寫失敗的測試**

```python
class TestMain(unittest.TestCase):
    def _minimal_workbook(self, path):
        wb = openpyxl.Workbook()
        wb.remove(wb.active)
        for name, spec in crf_fill.SHEETS.items():
            ws = wb.create_sheet(name)
            cols = list(dict.fromkeys(list(spec['key']) + list(spec['auto']) + ['備註']))
            for col, header in enumerate(cols, start=1):
                ws.cell(row=spec['header_row'], column=col).value = header
        wb.save(path)

    def _backup(self):
        return {
            'patients': [{'study_id': 'AAA-001', 'surgery_date': '2026-08-01',
                          'created_at': '2026-07-31T02:00:00+00:00',
                          'consent_date': '2026-07-31T02:00:00+00:00',
                          'surgeon_id': 'AAA', 'study_status': 'active'}],
            'surgical_records': [{'study_id': 'AAA-001', 'procedure_type': 'Hemorrhoidectomy',
                                  'hemorrhoid_grade': 'III', 'anesthesia_type': 'LMGA',
                                  'hemorrhoidectomy_subtype': 'Closed', 'energy_device': []}],
            'symptom_reports': [{'study_id': 'AAA-001', 'report_date': '2026-08-01',
                                 'pod': 0, 'pain_nrs': 3, 'wound': ['腫脹'],
                                 'report_source': 'app'}],
            'alerts': [], 'ai_chat_logs': [], 'usability_surveys': [],
            'healthcare_utilization': [], 'adherence_summary': [
                {'study_id': 'AAA-001', 'expected_reports': 1, 'max_pod': 0}],
        }

    def test_aborts_and_writes_nothing_when_coverage_incomplete(self):
        with tempfile.TemporaryDirectory() as d:
            crf = pathlib.Path(d) / '個案報告表_CRF紀錄.xlsx'
            self._minimal_workbook(crf)
            before = crf.read_bytes()
            backup = self._backup()
            backup['surgical_records'] = []
            with self.assertRaises(crf_fill.CrfError) as cm:
                crf_fill.run(backup, crf)
            self.assertIn('AAA-001', str(cm.exception))
            self.assertEqual(crf.read_bytes(), before)
            self.assertEqual(list(pathlib.Path(d).glob('*.bak-*.xlsx')), [])

    def test_fills_sheets_and_snapshots_first(self):
        with tempfile.TemporaryDirectory() as d:
            crf = pathlib.Path(d) / '個案報告表_CRF紀錄.xlsx'
            self._minimal_workbook(crf)
            crf_fill.run(self._backup(), crf)
            self.assertEqual(len(list(pathlib.Path(d).glob('*.bak-*.xlsx'))), 1)
            wb = openpyxl.load_workbook(crf)
            ws = wb['表單一_收案登記']
            idx = crf_fill.header_map(ws, 4)
            self.assertEqual(ws.cell(row=5, column=idx['Study ID']).value, 'AAA-001')
            self.assertEqual(ws.cell(row=5, column=idx['App 註冊完成']).value, '是')

    def test_rerun_is_idempotent(self):
        with tempfile.TemporaryDirectory() as d:
            crf = pathlib.Path(d) / '個案報告表_CRF紀錄.xlsx'
            self._minimal_workbook(crf)
            crf_fill.run(self._backup(), crf)
            crf_fill.run(self._backup(), crf)
            ws = openpyxl.load_workbook(crf)['表單二_每日症狀回報']
            idx = crf_fill.header_map(ws, 5)
            self.assertIsNone(ws.cell(row=7, column=idx['Study ID']).value)
```

「涵蓋率不足時不寫檔」要連備份檔都不產生。中止就該完全沒有副作用。

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd prototype/scripts && /usr/local/bin/python3 -m unittest test_crf_fill.TestMain -v`
Expected: FAIL，`module 'crf_fill' has no attribute 'run'`

- [ ] **Step 3: 實作 run 與 main**

```python
def run(backup, crf_path=CRF_PATH):
    missing = check_coverage(backup)
    if missing:
        raise CrfError(
            '這幾例沒有手術記錄，中止且未寫入任何內容：\n'
            f'  {"、".join(missing)}\n'
            'surgical_records 的 RLS 只讓研究人員看到自己的刀。'
            '若備份不是用 PI 帳號下載的，請改用 PI 帳號重新下載；'
            '若確實是主刀醫師還沒登錄手術記錄，請先補登。'
        )

    snapshot = backup_workbook(crf_path)
    ctx = build_context(backup)
    wb = openpyxl.load_workbook(crf_path)
    summary = []
    for name, spec in SHEETS.items():
        if name not in wb.sheetnames:
            raise CrfError(f'工作簿裡沒有分頁「{name}」')
        n = upsert_sheet(wb[name], spec['header_row'], spec['key'],
                         ctx[spec['source']], spec['auto'])
        summary.append(f'  {name}：{n} 列')
    wb.save(crf_path)
    return snapshot, summary


def main(argv):
    try:
        backup = load_backup(argv[1] if len(argv) > 1 else None)
        snapshot, summary = run(backup)
    except CrfError as err:
        print(f'中止：{err}', file=sys.stderr)
        return 1
    print(f'備份：{snapshot.name}')
    print('\n'.join(summary))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd prototype/scripts && /usr/local/bin/python3 -m unittest test_crf_fill -v`
Expected: 全部 PASS

- [ ] **Step 5: 對真實 CRF 實跑**

前置：Task 2 的前端改動要先部署完成，且 PI 已從 Dashboard 下載一份新的完整備份。

確認線上 bundle 已更新（比對字串，不要比對 hash）：

```bash
curl -s https://prototype-zeta-black.vercel.app/ \
  | grep -o '/assets/index-[^"]*\.js' | head -1
# 取上面的路徑，再 curl 該 bundle：
curl -s "https://prototype-zeta-black.vercel.app/assets/index-XXXX.js" \
  | grep -c "getAllSurgicalRecordsForResearcher"   # 應為 1 以上
```

然後實跑：

```bash
cd "/Users/huangshifeng/Desktop/Research/AI_Clinical/痔瘡AI衛教/prototype/scripts"
/usr/local/bin/python3 crf_fill.py
```

檢查輸出：備份檔名、六個分頁各寫入幾列。開啟 CRF 確認三件事：手填的 HSF-001 備註仍在、`個案總覽` 的 `POD（今日）` 仍是公式、`表單一` 的年齡/性別/BMI 仍為空白。

若因 FIH-003 缺手術記錄而中止，那是預期行為，請主刀醫師從 App 補登後重跑，不要為了跑過去而放寬檢查。

- [ ] **Step 6: 補登既有的就醫事件**

用 Task 3 的登錄卡把收案對照表備註欄裡那筆重返急診事件登進 `healthcare_utilization`，然後重跑 `crf_fill.py`，確認 `表單四` 出現該列。這一步同時驗證了 insert 路徑真的通。

- [ ] **Step 7: 寫研究日誌**

在 `研究日誌/2026-08-29.yaml` 記下：CRF 落後的實際數字、`healthcare_utilization` 是有表無寫入端的第幾個案例、`surgical_records` 的 per-surgeon RLS 會讓備份靜默少列這件事，以及 `hypotheses_ruled_out` 至少一則——「以為 CRF 需要新寫一支匯出器」被 PI 指出 Dashboard 已有完整備份功能而推翻。

格式見 `研究日誌/README.md`。同時在 `研究日誌/lessons_learned.json` 相關教訓的 `used_on` 補一筆（本次用到了 2026-08-13 的 xlsx 樣式坑）。

- [ ] **Step 8: Commit 並 push**

```bash
cd "/Users/huangshifeng/Desktop/Research/AI_Clinical/痔瘡AI衛教"
git add prototype/scripts/crf_fill.py prototype/scripts/test_crf_fill.py 研究日誌/2026-08-29.yaml 研究日誌/lessons_learned.json
git commit -m "feat(crf): fill the workbook from a backup file, aborting on incomplete coverage"
git push
```

CRF 工作簿本身與備份檔都被 `.gitignore:40` 涵蓋，不會進版控。commit 前確認 `git status --short` 沒有 `收案文件/` 底下的東西。

---

## Self-Review

**Spec coverage：** spec 的每一節都有對應任務。欄位權責邊界對到 Task 6 的 `SHEETS` 與其測試；架構 (a) 對到 Task 1–2，(b) 對到 Task 4–7；錯誤處理對到 Task 4 的 `check_coverage` 與 Task 7 的中止測試；測試一節的五項驗證分別落在 Task 5（1、2、5）、Task 6（3）、Task 7（4）。

**spec 未涵蓋而本計畫補上的：** spec 的「三個洞」表提到醫療利用要補最小 insert 路徑，但架構一節沒有描述它長什麼樣。Task 3 補上這個決定：`addUtilization()` 加上 `ResearcherPatientLookup` 的登錄卡片，POD 由日期相減算出而非手填。

**型別一致性：** `norm_date` 回傳 `str | None`，`upsert_sheet` 的鍵組裝與 `_row_key` 對日期欄用同一套正規化；`build_context` 產出的五個 source 鍵（`overview`、`reports`、`alerts`、`hcu`、`closed`）與 `SHEETS` 各分頁的 `source` 值一一對應。
