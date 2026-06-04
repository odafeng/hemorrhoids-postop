// E2E: Surgical Record form
// - UI gating (always): demo mode shows "不支援" placeholder; button hidden in demo lookup
// - Real flow: env-gated with E2E_PI_EMAIL / E2E_PI_PASSWORD

import { test, expect } from '@playwright/test';

const piEmail = process.env.E2E_PI_EMAIL || '';
const piPassword = process.env.E2E_PI_PASSWORD || '';

test.describe('Surgical Record — demo UI gating', () => {
  test('demo researcher lookup does NOT show 撰寫手術紀錄 button', async ({ page }) => {
    // Demo mode lookup has no DB, only shows "Demo 模式不支援即時查詢"
    // which means no case-detail card → button is never rendered.
    await page.goto('/');
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 10_000 });
    await page.locator('.role-toggle button').filter({ hasText: '研究人員' }).click();
    await page.getByRole('button', { name: /Demo 模式/ }).click();
    await expect(page.getByText(/研究者儀表板/)).toBeVisible({ timeout: 10_000 });

    await page.locator('nav.bottom-nav').getByText('查詢').click();
    await expect(page.getByText('病人查詢')).toBeVisible({ timeout: 10_000 });
    await page.locator('.search-box input').fill('HEM-001');
    await page.getByRole('button', { name: /^查詢/ }).click();
    // Demo placeholder shows instead of case detail
    await expect(page.getByText(/Demo 模式不支援/)).toBeVisible({ timeout: 5_000 });
    // Surgical record entry button must not appear anywhere on page
    await expect(page.getByRole('button', { name: /撰寫手術紀錄/ })).toHaveCount(0);
  });
});

test.describe('Surgical Record — PI real flow', () => {
  test.skip(!piEmail || !piPassword, 'E2E_PI_EMAIL / E2E_PI_PASSWORD not set');

  test.beforeEach(async ({ page }) => {
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('[BROWSER ERROR]', m.text());
    });
    await page.goto('/');
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder('your@email.com').fill(piEmail);
    await page.getByPlaceholder('••••••••').fill(piPassword);
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByText(/研究者儀表板/)).toBeVisible({ timeout: 20_000 });
  });

  test('PI → lookup → 撰寫手術紀錄 → fill → save', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('查詢').click();
    await expect(page.getByText('病人查詢')).toBeVisible({ timeout: 10_000 });

    await page.locator('.search-box input').fill('HSF-003');
    await page.getByRole('button', { name: /^查詢/ }).click();
    await expect(page.getByText('HSF-003')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /撰寫手術紀錄/ }).click();
    await expect(page.getByText('撰寫手術紀錄')).toBeVisible({ timeout: 10_000 });

    // Fill form
    await page.getByText('痔瘡切除術').click();
    await page.getByRole('button', { name: 'Closed' }).click();
    await page.getByRole('button', { name: 'Grade III' }).click();
    await page.getByRole('button', { name: '3' }).click();
    await page.getByRole('button', { name: '7' }).click();
    await page.getByRole('button', { name: '11' }).click();

    // Blood loss / duration
    await page.locator('input[type="number"]').first().fill('15');
    await page.locator('input[type="number"]').nth(1).fill('30');

    await page.getByRole('button', { name: /Lithotomy/ }).click();
    await page.getByRole('button', { name: /Quikclot/ }).click();

    await page.locator('textarea').fill('E2E test run');

    await page.getByRole('button', { name: /^儲存手術紀錄/ }).click();
    await expect(page.getByText('手術紀錄已儲存')).toBeVisible({ timeout: 10_000 });
  });

  test('Reopening prefills saved values', async ({ page }) => {
    await page.goto('/surgical-record/HSF-003');
    await expect(page.getByText('撰寫手術紀錄')).toBeVisible({ timeout: 10_000 });
    // procedureType should still be set from prior save
    await expect(page.getByRole('button', { name: '痔瘡切除術' })).toHaveClass(/selected/);
  });
});
