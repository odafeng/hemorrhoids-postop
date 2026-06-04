// E2E: Auth mode — real Supabase login, tests report submit + AI chat + DB verification
// Requires GitHub Secrets: E2E_EMAIL, E2E_PASSWORD, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
import { test, expect } from '@playwright/test';

const email = process.env.E2E_EMAIL || '';
const password = process.env.E2E_PASSWORD || '';
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function querySupabase(table: string, params: string) {
  if (!serviceKey) return null;
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${params}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  return res.json();
}

async function deleteSupabase(table: string, params: string) {
  if (!serviceKey) return;
  await fetch(`${supabaseUrl}/rest/v1/${table}?${params}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
}

const E2E_STUDY_ID = 'TEST-001';

test.describe('Auth Mode — Report & AI Chat', () => {
  test.skip(!email || !password, 'E2E_EMAIL / E2E_PASSWORD not set');

  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('[BROWSER ERROR]', msg.text());
    });

    // Poll the dashboard (reloading) until the just-written report is reflected —
    // an authenticated read can transiently miss the token under CI load.
    await expect(async () => {
      await page.goto('/');
      await expect(page.locator('.pod-hero')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText('已完成今日回報')).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });

    // DB verification
    if (serviceKey && supabaseUrl) {
      const today = new Date().toLocaleDateString('en-CA');
      const reports = await querySupabase(
        'symptom_reports',
        `study_id=eq.${E2E_STUDY_ID}&report_date=eq.${today}&select=*`
      );

      expect(reports).toBeTruthy();
      expect(reports.length).toBeGreaterThanOrEqual(1);

      const report = reports[reports.length - 1];
      expect(report.pain_nrs).toBe(4);
      expect(report.bleeding).toBe('少量');
      expect(report.bowel).toBe('正常');
      expect(report.fever).toBe(false);
      expect(report.urinary).toBe('正常');
      expect(report.continence).toBe('正常');
      expect(report.wound).toContain('無異常');

      console.log('[DB Verify] ✓ symptom_reports row confirmed:', {
        study_id: report.study_id,
        report_date: report.report_date,
        pain_nrs: report.pain_nrs,
        bleeding: report.bleeding,
      });
    }
  });

  test('History shows submitted report data', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    // Poll history (reloading) until the submitted report row shows up.
    await expect(async () => {
      await page.goto('/history');
      await expect(page.getByText(/恢復歷程/)).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText(/共 d+ 次回報/)).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText(today).first()).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });

    // Timeline items now use .tl-item (template-aligned)
    const tlItems = page.locator('.tl-item');
    await expect(tlItems.first()).toBeVisible();

    const latest = tlItems.first();
    await expect(latest.locator('.sym-val .unit').first()).toHaveText('/10');
    await expect(latest.getByText('出血')).toBeVisible();
    await expect(latest.getByText('排便')).toBeVisible();
    await expect(latest.getByText('傷口')).toBeVisible();
  });

  test('AI Chat — ask question and get Claude response + verify DB', async ({ page }) => {
    // CI must not call the paid Claude API: stub ai-chat with a deterministic SSE stream.
    await page.route('**/functions/v1/ai-chat', (route) => {
      const NL = String.fromCharCode(10);
      const body = 'data: ' + JSON.stringify({ type: 'delta', text: '痔瘡術後請保持傷口清潔乾燥，溫水坐浴，並依醫囑服藥。' }) + NL + NL
               + 'data: ' + JSON.stringify({ type: 'done', sources: [] }) + NL + NL;
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body });
    });
    await page.locator('nav.bottom-nav').getByText('AI 衛教').click();
    // Bubble class renamed: .chat-bubble → .bubble
    await expect(page.locator('.bubble.ai').first()).toBeVisible({ timeout: 10_000 });

    const quickBtn = page.locator('button.quick-q').first();
    await quickBtn.click();

    await expect(page.locator('.bubble.ai').nth(1)).toBeVisible({ timeout: 30_000 });

    const secondBubble = page.locator('.bubble.ai').nth(1);
    await expect(secondBubble.locator('.bubble-label')).toContainText(/AI · (Claude Haiku|離線模式)/);

    await expect(secondBubble.getByText('僅供衛教參考')).toBeVisible();

    if (serviceKey && supabaseUrl) {
      // saveChatLog runs after the AI bubble renders, so poll until the row lands.
      let chatLogs;
      await expect.poll(async () => {
        chatLogs = await querySupabase(
          'ai_chat_logs',
          `study_id=eq.${E2E_STUDY_ID}&order=created_at.desc&limit=1&select=*`
        );
        return chatLogs?.length ?? 0;
      }, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);

      const log = chatLogs[0];
      expect(log.user_message).toBeTruthy();
      expect(log.ai_response).toBeTruthy();
      expect(log.ai_response.length).toBeGreaterThan(10);

      console.log('[DB Verify] ✓ ai_chat_logs row confirmed:', {
        study_id: log.study_id,
        user_message: log.user_message.slice(0, 30),
        ai_response_length: log.ai_response.length,
      });
    }
  });

  test('Logout works', async ({ page }) => {
    await page.getByLabel('登出').click();
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 10_000 });
  });

  test.afterAll(async () => {
    if (!serviceKey || !supabaseUrl) return;

    console.log('[Cleanup] Removing E2E test data for', E2E_STUDY_ID);

    await deleteSupabase('ai_chat_logs', `study_id=eq.${E2E_STUDY_ID}`);
    await deleteSupabase('alerts', `study_id=eq.${E2E_STUDY_ID}`);
    await deleteSupabase('symptom_reports', `study_id=eq.${E2E_STUDY_ID}`);

    console.log('[Cleanup] ✓ Done — ai_chat_logs, alerts, symptom_reports cleared');
  });
});
