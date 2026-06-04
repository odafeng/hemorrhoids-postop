// E2E: Researcher mode — real Supabase login
// Requires GitHub Secrets: E2E_RESEARCHER_EMAIL, E2E_RESEARCHER_PASSWORD
import { test, expect } from '@playwright/test';

const email = process.env.E2E_RESEARCHER_EMAIL || '';
const password = process.env.E2E_RESEARCHER_PASSWORD || '';

test.describe('Researcher — Dashboard & Tools', () => {
  test.skip(!email || !password, 'E2E_RESEARCHER_EMAIL / E2E_RESEARCHER_PASSWORD not set');

  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('[BROWSER ERROR]', msg.text());
    });

    await page.goto('/');
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 30_000 });
    await page.getByPlaceholder('your@email.com').fill(email);
    await page.getByPlaceholder('••••••••').fill(password);
    await page.locator('form button[type="submit"]').click();

    await expect(page.getByText(/研究者儀表板/)).toBeVisible({ timeout: 20_000 });
  });

  test('Dashboard shows stats, cohort list, and export section', async ({ page }) => {
    await expect(page.getByText('ENROLLED')).toBeVisible();
    await expect(page.getByText('ADHERENCE')).toBeVisible();
    await expect(page.getByText('ALERTS')).toBeVisible();
    await expect(page.getByText('PENDING AI')).toBeVisible();

    await expect(page.getByText(/COHORT ·/)).toBeVisible();

    await expect(page.getByRole('button', { name: /症狀回報/ })).toBeVisible();

    await expect(page.getByLabel('登出')).toBeVisible();
  });

  test('Patient lookup — search by study ID', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('查詢').click();
    await expect(page.getByText('病人查詢')).toBeVisible({ timeout: 30_000 });

    await page.locator('.search-box input').fill('TEST-001');
    await page.getByRole('button', { name: /查詢/ }).click();

    await expect(page.getByText('TEST-001')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Surgery Date|未建檔/)).toBeVisible({ timeout: 30_000 });
  });

  test('Chat review page loads and shows review UI', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('審核').click();
    await expect(page.getByText('AI 回覆審核')).toBeVisible({ timeout: 30_000 });
    // Matcher may hit multiple elements (e.g. "待審核 0 則" in page-sub + "所有…已審核完畢"),
    // so use .first() to satisfy strict mode.
    await expect(
      page.getByText(/待審核|所有 AI 回覆皆已審核完畢|尚無 AI 回覆紀錄/).first()
    ).toBeVisible();
  });

  test('Logout works', async ({ page }) => {
    await page.getByLabel('登出').click();
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 30_000 });
  });
});
