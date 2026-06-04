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

    await page.goto('/');
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder('your@email.com').fill(email);
    await page.getByPlaceholder('••••••••').fill(password);
    await page.locator('form button[type="submit"]').click();

    // First: make sure we left the login page (form should disappear)
    await expect(page.getByPlaceholder('your@email.com')).not.toBeVisible({ timeout: 20_000 }).catch(async () => {
      const bodyText = await page.locator('body').innerText();
      throw new Error(`Login failed — still on login page. Page text: ${bodyText.slice(0, 500)}`);
    });

    // Dashboard ready when pod-hero renders (uses the in-memory login session).
    await expect(page.locator('.pod-hero')).toBeVisible({ timeout: 20_000 });
  });

  test('Submit symptom report (full form) + verify DB', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('回報').click();
    await expect(page.getByText('今日症狀回報')).toBeVisible({ timeout: 10_000 });

    // Pain slider (inside .pain-hero — specific to avoid matching the field slider)
    await page.locator('.pain-hero input[type="range"]').fill('4');

    // Form fields use .field now (was .form-group)
    const bleedingField = page.locator('.field', { has: page.getByText('出血程度') });
    await bleedingField.getByRole('button', { name: /少量/ }).click();

    const bowelField = page.locator('.field', { has: page.getByText('排便狀況') });
    await bowelField.getByRole('button', { name: '正常' }).click();

    const continenceField = page.locator('.field', { has: page.getByText('肛門控制') });
    await continenceField.getByRole('button', { name: /正常/ }).click();

    const feverField = page.locator('.field', { has: page.getByText(/發燒/) });
    await feverField.getByRole('button', { name: '否' }).click();

    const urinaryField = page.locator('.field', { has: page.getByText('排尿狀況') });
    await urinaryField.getByRole('button', { name: /正常/ }).click();

    const woundField = page.locator('.field', { has: page.getByText('傷口狀況') });
    const woundBtn = woundField.getByRole('button', { name: '無異常' });
    const isWoundSelected = await woundBtn.evaluate((el) => el.classList.contains('selected'));
    if (!isWoundSelected) await woundBtn.click();

    const submitBtn = page.getByRole('button', { name: /提交回報/ });
    await submitBtn.scrollIntoViewIfNeeded();
    await submitBtn.click();

    await expect(page.getByText('回報成功')).toBeVisible({ timeout: 10_000 });

    // App SPA-navigates back to the dashboard and invalidates the report query on
    // completion; assert via that in-memory session (a full page reload drops the
    // auth token on the CI runner and reads come back empty).
    await expect(page.locator('.pod-hero')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('已完成今日回報')).toBeVisible({ timeout: 15_000 });

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
    await page.locator('nav.bottom-nav').getByText('紀錄').click();
    await expect(page.getByText('恢復歷程')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/共 \d+ 次回報/)).toBeVisible({ timeout: 15_000 });
    const today = new Date().toLocaleDateString('en-CA');
    await expect(page.getByText(today).first()).toBeVisible({ timeout: 15_000 });

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
