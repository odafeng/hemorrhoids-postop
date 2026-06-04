// E2E: PI invites a new researcher / PI via email
// - UI gating checks (run always): demo researcher must NOT see PI-only panel
// - PI flow (env-gated): E2E_PI_EMAIL / E2E_PI_PASSWORD required

import { test, expect } from '@playwright/test';

const piEmail = process.env.E2E_PI_EMAIL || '';
const piPassword = process.env.E2E_PI_PASSWORD || '';

test.describe('Researcher invite — UI gating (demo)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('[BROWSER ERROR]', m.text());
    });
    await page.goto('/');
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 10_000 });
  });

  test('demo researcher does NOT see PI-only invite panel', async ({ page }) => {
    // Switch role toggle to 研究人員, then click Demo button
    await page.locator('.role-toggle button').filter({ hasText: '研究人員' }).click();
    await page.getByRole('button', { name: /Demo 模式/ }).click();

    // Should land on researcher dashboard
    await expect(page.getByText(/研究者儀表板/)).toBeVisible({ timeout: 10_000 });

    // PI-only "新增研究人員" card must be hidden
    await expect(page.getByText('新增研究人員')).toHaveCount(0);

    // Invite tokens card is also hidden in demo (isDemo gated)
    await expect(page.getByText('產生收案邀請碼')).toHaveCount(0);
  });
});

test.describe('Researcher invite — PI flow (real Supabase)', () => {
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

  test('PI sees 新增研究人員 panel', async ({ page }) => {
    await expect(page.getByText('新增研究人員')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder('researcher@example.com')).toBeVisible();
    await expect(page.getByPlaceholder(/研究助理/)).toBeVisible();
  });

  test('empty fields → inline error', async ({ page }) => {
    await page.getByRole('button', { name: /寄出邀請信/ }).click();
    await expect(page.getByText('請輸入 Email 與姓名')).toBeVisible();
  });

  test('role toggle switches between 研究人員 and PI', async ({ page }) => {
    const piCard = page.locator('.card', { has: page.getByText('新增研究人員') });
    const researcherBtn = piCard.locator('.role-toggle button').filter({ hasText: '研究人員' });
    const piBtn = piCard.locator('.role-toggle button').filter({ hasText: /主持人/ });

    // Default: 研究人員 is on
    await expect(researcherBtn).toHaveClass(/on/);
    await piBtn.click();
    await expect(piBtn).toHaveClass(/on/);
    await expect(researcherBtn).not.toHaveClass(/on/);
  });

  test('invalid email → server error surfaced', async ({ page }) => {
    // Mock the Edge Function to return a 400 so we don't actually call Supabase
    await page.route('**/functions/v1/researcher-invite', async (route) => {
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Email 格式不正確' }),
      });
    });

    await page.getByPlaceholder('researcher@example.com').fill('not-an-email');
    await page.getByPlaceholder(/研究助理/).fill('測試用');
    await page.getByRole('button', { name: /寄出邀請信/ }).click();

    await expect(page.getByText('Email 格式不正確')).toBeVisible({ timeout: 10_000 });
  });

  test('successful invite → success banner shown', async ({ page }) => {
    // Mock a 200 so no real email is sent
    const testEmail = `e2e-researcher-${Date.now()}@test.example.com`;
    await page.route('**/functions/v1/researcher-invite', async (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          user: { id: 'mock-uuid', email: testEmail, role: 'researcher', display_name: '測試人員' },
        }),
      });
    });

    await page.getByPlaceholder('researcher@example.com').fill(testEmail);
    await page.getByPlaceholder(/研究助理/).fill('測試人員');
    await page.getByRole('button', { name: /寄出邀請信/ }).click();

    await expect(page.getByText(`✓ 已寄出邀請信到 ${testEmail}`)).toBeVisible({ timeout: 10_000 });

    // Form should have cleared
    await expect(page.getByPlaceholder('researcher@example.com')).toHaveValue('');
    await expect(page.getByPlaceholder(/研究助理/)).toHaveValue('');
  });

  test('duplicate email → server 409 surfaced', async ({ page }) => {
    await page.route('**/functions/v1/researcher-invite', async (route) => {
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'dup@example.com 已經註冊過' }),
      });
    });

    await page.getByPlaceholder('researcher@example.com').fill('dup@example.com');
    await page.getByPlaceholder(/研究助理/).fill('重複測試');
    await page.getByRole('button', { name: /寄出邀請信/ }).click();

    await expect(page.getByText('dup@example.com 已經註冊過')).toBeVisible({ timeout: 10_000 });
  });
});
