// E2E: Login Page Flow — UI only, no Supabase
import { test, expect } from '@playwright/test';

test.describe('Login Page — UI Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 10_000 });
  });

  test('renders all login page elements', async ({ page }) => {
    await expect(page.getByText('術後追蹤系統')).toBeVisible();
    await expect(page.getByText(/痔瘡手術術後症狀監測/)).toBeVisible();

    // Mode tabs are in .seg now
    await expect(page.locator('.seg button').filter({ hasText: '登入' })).toBeVisible();
    await expect(page.locator('.seg button').filter({ hasText: '註冊' })).toBeVisible();

    // Role toggle (patient / researcher)
    await expect(page.locator('.role-toggle button').filter({ hasText: '病人' })).toBeVisible();
    await expect(page.locator('.role-toggle button').filter({ hasText: '研究人員' })).toBeVisible();

    // Form fields
    await expect(page.getByPlaceholder('your@email.com')).toBeVisible();
    await expect(page.getByPlaceholder('••••••••')).toBeVisible();

    // Submit — single button, text contains 登入
    const submit = page.locator('form button[type="submit"]');
    await expect(submit).toBeVisible();
    await expect(submit).toContainText('登入');

    // Forgot password link
    await expect(page.getByText('忘記密碼？')).toBeVisible();

    // Demo button (single, role-aware)
    await expect(page.getByRole('button', { name: /Demo 模式/ })).toBeVisible();
  });

  test('switches between login and register tabs', async ({ page }) => {
    await page.locator('.seg button').filter({ hasText: '註冊' }).click();
    await expect(page.locator('form button[type="submit"]')).toContainText('建立帳號');
    await expect(page.getByPlaceholder('請輸入研究團隊提供的邀請碼')).toBeVisible();
    await expect(page.locator('select')).toBeVisible();
    await expect(page.getByPlaceholder('001')).toBeVisible();
    await expect(page.locator('input[type="date"]')).toBeVisible();

    await page.locator('.seg button').filter({ hasText: '登入' }).click();
    await expect(page.locator('form button[type="submit"]')).toContainText('登入');
    await expect(page.getByPlaceholder('請輸入研究團隊提供的邀請碼')).not.toBeVisible();
  });

  test('forgot password flow', async ({ page }) => {
    await page.getByText('忘記密碼？').click();
    await expect(page.getByText('重設密碼')).toBeVisible();
    await expect(page.locator('form button[type="submit"]')).toContainText('發送重設連結');
    await expect(page.getByText(/輸入您的電子郵件/)).toBeVisible();
    await expect(page.getByPlaceholder('••••••••')).not.toBeVisible();
    await page.getByText('← 返回登入').click();
    await expect(page.locator('form button[type="submit"]')).toContainText('登入');
    await expect(page.getByPlaceholder('••••••••')).toBeVisible();
  });

  test('Demo mode (patient default) enters patient dashboard', async ({ page }) => {
    await page.getByRole('button', { name: /Demo 模式/ }).click();
    await expect(page.locator('.pod-hero')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.brand-text .hospital')).toContainText('DEMO');
  });

  test('Researcher demo — switch role then click Demo', async ({ page }) => {
    await page.locator('.role-toggle button').filter({ hasText: '研究人員' }).click();
    await page.getByRole('button', { name: /Demo 模式/ }).click();
    await expect(page.getByText(/研究者儀表板/)).toBeVisible({ timeout: 10_000 });
  });

  test('password eye toggle reveals password', async ({ page }) => {
    const pwd = page.getByPlaceholder('••••••••');
    await pwd.fill('secret123');
    await expect(pwd).toHaveAttribute('type', 'password');
    await page.locator('.input-eye').click();
    const revealed = page.locator('.input-password-wrap input');
    await expect(revealed).toHaveAttribute('type', 'text');
    await page.locator('.input-eye').click();
    await expect(page.locator('.input-password-wrap input')).toHaveAttribute('type', 'password');
  });

  test('theme toggle on login page', async ({ page }) => {
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await page.locator('.login .icon-btn').first().click();
    await expect.poll(async () => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
      .not.toBe(before);
  });

  test('login stays on form when Supabase rejects (no env)', async ({ page }) => {
    await page.getByPlaceholder('your@email.com').fill('nonexistent@test.com');
    await page.getByPlaceholder('••••••••').fill('wrongpassword');
    await page.locator('form button[type="submit"]').click();
    await page.waitForTimeout(2_000);
    await expect(page.getByPlaceholder('your@email.com')).toBeVisible();
  });
});
