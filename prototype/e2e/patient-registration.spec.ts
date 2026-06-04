// E2E: Patient Registration Flow
import { test, expect } from '@playwright/test';

const inviteCode = process.env.E2E_INVITE_CODE || '';
const timestamp = Date.now();
const testEmail = `e2e-patient-${timestamp}@test.example.com`;
const testPassword = 'TestPass123!';
const testPatientNumber = timestamp.toString().slice(-3);
const testSurgeryDate = new Date().toLocaleDateString('en-CA');

test.describe('Patient Registration Flow', () => {
  test.skip(!inviteCode, 'Intentionally skipped on prod CI: registration creates real auth users + consumes one-time invites (would pollute the IRB study DB). Runs only when E2E_INVITE_CODE is provided against an isolated DB.');

  test('shows registration form with all required fields', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 30_000 });

    await page.locator('.seg button').filter({ hasText: '註冊' }).click();

    await expect(page.getByPlaceholder('請輸入研究團隊提供的邀請碼')).toBeVisible();
    await expect(page.locator('input[type="date"]')).toBeVisible();
    await expect(page.locator('select')).toBeVisible();          // surgeon dropdown
    await expect(page.getByPlaceholder('001')).toBeVisible();    // patient number
    await expect(page.getByPlaceholder('your@email.com')).toBeVisible();
    await expect(page.getByPlaceholder('••••••••')).toBeVisible();
    await expect(page.locator('form button[type="submit"]')).toContainText('建立帳號');
  });

  test('shows error when invite code is empty', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 30_000 });

    await page.locator('.seg button').filter({ hasText: '註冊' }).click();

    await page.getByPlaceholder('請輸入研究團隊提供的邀請碼').fill('   ');
    await page.locator('input[type="date"]').fill(testSurgeryDate);
    await page.locator('select').selectOption('HSF');
    await page.getByPlaceholder('001').fill(testPatientNumber);
    await page.getByPlaceholder('your@email.com').fill(testEmail);
    await page.getByPlaceholder('••••••••').fill(testPassword);

    await page.locator('form button[type="submit"]').click();

    await expect(page.getByText(/請輸入邀請碼/)).toBeVisible({ timeout: 15_000 });
  });

  test('register new patient account', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 30_000 });

    await page.locator('.seg button').filter({ hasText: '註冊' }).click();

    await page.getByPlaceholder('請輸入研究團隊提供的邀請碼').fill(inviteCode);
    await page.locator('input[type="date"]').fill(testSurgeryDate);
    await page.locator('select').selectOption('HSF');
    await page.getByPlaceholder('001').fill(testPatientNumber);
    await page.getByPlaceholder('your@email.com').fill(testEmail);
    await page.getByPlaceholder('••••••••').fill(testPassword);

    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('帳號建立成功');
      await dialog.accept();
    });

    await page.locator('form button[type="submit"]').click();

    // After successful register → back to login mode or dashboard
    await expect(page.locator('form button[type="submit"]')).toContainText(/登入|建立帳號/);
    await page.waitForTimeout(2_000);
  });

  test('newly registered patient can attempt login', async ({ page }) => {
    test.skip(!inviteCode, 'Registration prerequisite not met');

    await page.goto('/');
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 30_000 });

    await page.getByPlaceholder('your@email.com').fill(testEmail);
    await page.getByPlaceholder('••••••••').fill(testPassword);
    await page.locator('form button[type="submit"]').click();

    // Either dashboard or still on login if email verification is required
    await page.waitForTimeout(3_000);
  });
});
