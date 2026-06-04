// E2E: Demo mode — quick smoke test (no Supabase needed)
import { test, expect } from '@playwright/test';

test.describe('Demo Mode — Patient Smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /Demo 模式/ }).click();
    await expect(page.locator('.pod-hero')).toBeVisible({ timeout: 10_000 });
  });

  test('Dashboard → pages load → logout', async ({ page }) => {
    await expect(page.getByText(/Today · 今日回報/)).toBeVisible();
    await expect(page.getByText(/Adherence · 回報率/)).toBeVisible();

    await page.locator('nav.bottom-nav').getByText('紀錄').click();
    await expect(page.getByText('恢復歷程')).toBeVisible();

    await page.locator('nav.bottom-nav').getByText('AI 衛教').click();
    await expect(page.locator('.bubble.ai').first()).toBeVisible();

    await page.locator('nav.bottom-nav').getByText('首頁').click();
    await page.getByLabel('登出').click();
    await expect(page.getByText('術後追蹤系統')).toBeVisible();
  });
});

test.describe('Demo Mode — Researcher Smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 10_000 });
    await page.locator('.role-toggle button').filter({ hasText: '研究人員' }).click();
    await page.getByRole('button', { name: /Demo 模式/ }).click();
    await expect(page.getByText(/研究者儀表板/)).toBeVisible({ timeout: 10_000 });
  });

  test('Dashboard shows stats and cohort', async ({ page }) => {
    await expect(page.getByText('ENROLLED')).toBeVisible();
    await expect(page.getByText('ADHERENCE')).toBeVisible();
    await expect(page.getByText('ALERTS')).toBeVisible();
    await expect(page.getByText(/COHORT ·/)).toBeVisible();
  });

  test('Patient lookup page loads', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('查詢').click();
    await expect(page.getByText('病人查詢')).toBeVisible();
    await expect(page.locator('.search-box input')).toBeVisible();
  });

  test('Chat review page loads', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('審核').click();
    await expect(page.getByText('AI 回覆審核')).toBeVisible();
  });

  test('Export buttons exist', async ({ page }) => {
    await expect(page.getByRole('button', { name: /症狀回報/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /警示紀錄/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /AI 對話紀錄 CSV/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /全量資料備份/ })).toBeVisible();
  });

  test('Logout works', async ({ page }) => {
    await page.getByLabel('登出').click();
    await expect(page.getByText('術後追蹤系統')).toBeVisible();
  });
});
