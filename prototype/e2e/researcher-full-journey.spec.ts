// E2E: Complete Researcher User Journey (Demo Mode)
// Exercises every researcher path without hitting Supabase.
import { test, expect } from '@playwright/test';

test.describe('Researcher Full Journey — Demo Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 10_000 });
    // Switch role toggle to 研究人員 first, then click Demo
    await page.locator('.role-toggle button').filter({ hasText: '研究人員' }).click();
    await page.getByRole('button', { name: /Demo 模式/ }).click();
    await expect(page.getByText(/研究者儀表板/)).toBeVisible({ timeout: 10_000 });
  });

  test('Dashboard displays all key stats', async ({ page }) => {
    await expect(page.getByText('ENROLLED')).toBeVisible();
    await expect(page.getByText('ADHERENCE')).toBeVisible();
    await expect(page.getByText('ALERTS')).toBeVisible();
    await expect(page.getByText('PENDING AI')).toBeVisible();
    await expect(page.getByText(/COHORT ·/)).toBeVisible();
    await expect(page.getByText('資料匯出')).toBeVisible();
    await expect(page.getByLabel('登出')).toBeVisible();
  });

  test('Cohort list shows mock patients', async ({ page }) => {
    await expect(page.locator('.cohort-row').first()).toBeVisible({ timeout: 5_000 });
  });

  test('CSV export — symptom reports', async ({ page }) => {
    await page.getByRole('button', { name: /症狀回報/ }).click();
    await page.waitForTimeout(800);
  });

  test('CSV export — alerts', async ({ page }) => {
    await page.getByRole('button', { name: /警示紀錄/ }).click();
    await page.waitForTimeout(800);
  });

  test('CSV export — AI chat logs', async ({ page }) => {
    await page.getByRole('button', { name: /AI 對話紀錄/ }).click();
    await page.waitForTimeout(800);
  });

  test('Full JSON backup', async ({ page }) => {
    await page.getByRole('button', { name: /全量資料備份/ }).click();
    await page.waitForTimeout(800);
  });

  test('Navigate to Patient Lookup and search', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('查詢').click();
    await expect(page.getByText('病人查詢')).toBeVisible({ timeout: 5_000 });
    const searchInput = page.locator('.search-box input');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('HEM-001');
    await page.getByRole('button', { name: /查詢/ }).click();
    await page.waitForTimeout(1_500);
  });

  test('Patient Lookup — not-found ID in demo returns placeholder', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('查詢').click();
    await expect(page.getByText('病人查詢')).toBeVisible({ timeout: 5_000 });
    await page.locator('.search-box input').fill('NONEXIST-999');
    await page.getByRole('button', { name: /查詢/ }).click();
    await expect(page.getByText(/Demo 模式不支援/)).toBeVisible({ timeout: 5_000 });
  });

  test('Navigate to Chat Review', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('審核').click();
    await expect(page.getByText('AI 回覆審核')).toBeVisible({ timeout: 5_000 });
  });

  test('Chat Review individual correct action', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('審核').click();
    await expect(page.getByText('AI 回覆審核')).toBeVisible({ timeout: 5_000 });
    const reviewBtn = page.getByRole('button', { name: /審核此則/ }).first();
    if (await reviewBtn.isVisible().catch(() => false)) {
      await reviewBtn.click();
      const correctBtn = page.getByRole('button', { name: /^✓ 正確$/ }).first();
      if (await correctBtn.isVisible().catch(() => false)) {
        await correctBtn.click();
        await page.waitForTimeout(500);
      }
    }
  });

  test('Chat Review batch review prompt', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('審核').click();
    await expect(page.getByText('AI 回覆審核')).toBeVisible({ timeout: 5_000 });
    const batchBtn = page.getByRole('button', { name: /批次審核全部/ });
    if (await batchBtn.isVisible().catch(() => false)) {
      await batchBtn.click();
      await expect(page.getByText(/將.*則未審核/)).toBeVisible({ timeout: 3_000 });
    }
  });

  test('Bottom nav tabs navigate to all researcher pages', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('查詢').click();
    await expect(page.getByText('病人查詢')).toBeVisible({ timeout: 5_000 });

    await page.locator('nav.bottom-nav').getByText('審核').click();
    await expect(page.getByText('AI 回覆審核')).toBeVisible({ timeout: 5_000 });

    await page.locator('nav.bottom-nav').getByText('概覽').click();
    await expect(page.getByText(/研究者儀表板/)).toBeVisible({ timeout: 5_000 });
  });

  test('Logout returns to login page', async ({ page }) => {
    await page.getByLabel('登出').click();
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByPlaceholder('your@email.com')).toBeVisible();
  });
});

// Real-Supabase researcher auth
test.describe('Researcher Registration & Auth', () => {
  const email = process.env.E2E_RESEARCHER_EMAIL || '';
  const password = process.env.E2E_RESEARCHER_PASSWORD || '';

  test.skip(!email || !password, 'E2E_RESEARCHER_EMAIL / E2E_RESEARCHER_PASSWORD not set');

  test('Researcher login lands on researcher dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 10_000 });

    await page.getByPlaceholder('your@email.com').fill(email);
    await page.getByPlaceholder('••••••••').fill(password);
    await page.locator('form button[type="submit"]').click();

    await expect(page.getByText(/研究者儀表板/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('ENROLLED')).toBeVisible();
  });

  test('Researcher navigates all pages with real data', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('your@email.com').fill(email);
    await page.getByPlaceholder('••••••••').fill(password);
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByText(/研究者儀表板/)).toBeVisible({ timeout: 20_000 });

    await expect(page.getByText('ENROLLED')).toBeVisible();

    await page.locator('nav.bottom-nav').getByText('查詢').click();
    await expect(page.getByText('病人查詢')).toBeVisible({ timeout: 5_000 });

    await page.locator('nav.bottom-nav').getByText('審核').click();
    await expect(page.getByText('AI 回覆審核')).toBeVisible({ timeout: 5_000 });

    await page.locator('nav.bottom-nav').getByText('概覽').click();
    await expect(page.getByText(/研究者儀表板/)).toBeVisible({ timeout: 5_000 });

    await page.getByLabel('登出').click();
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 10_000 });
  });
});
