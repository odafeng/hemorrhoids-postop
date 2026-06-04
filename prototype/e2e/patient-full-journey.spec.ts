// E2E: Complete Patient User Journey (Demo Mode)
import { test, expect } from '@playwright/test';

test.describe('Patient Full Journey — Demo Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 10_000 });
    // Default role is patient; click Demo button
    await page.getByRole('button', { name: /Demo 模式/ }).click();
    // Dashboard ready when pod-hero shows
    await expect(page.locator('.pod-hero')).toBeVisible({ timeout: 10_000 });
  });

  test('Dashboard displays all key sections', async ({ page }) => {
    // Brand topbar
    await expect(page.locator('.brand-text .system')).toHaveText('術後追蹤系統');
    await expect(page.locator('.brand-text .hospital')).toContainText('DEMO');

    // POD hero
    await expect(page.locator('.pod-hero .pod-number')).toBeVisible();
    await expect(page.getByText(/術後天數 · POST-OP DAY/)).toBeVisible();

    // Today report card
    await expect(page.getByText(/Today · 今日回報/)).toBeVisible();

    // Stats grid
    await expect(page.getByText(/Adherence · 回報率/)).toBeVisible();
    await expect(page.getByText(/Latest Pain · 最新疼痛/)).toBeVisible();

    // Quick actions
    await expect(page.getByText('快捷功能')).toBeVisible();

    // Logout (icon-only, has aria-label)
    await expect(page.getByLabel('登出')).toBeVisible();
  });

  test('Fill and submit symptom report', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('回報').click();
    await expect(page.getByText('今日症狀回報')).toBeVisible({ timeout: 5_000 });

    // Pain slider
    await page.locator('.pain-hero input[type="range"]').fill('5');
    await expect(page.locator('.pain-hero .lvl')).toHaveText('中度疼痛');

    // Bleeding field (in .field block with label 出血程度)
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
    await woundField.getByRole('button', { name: '無異常' }).click();

    const submit = page.getByRole('button', { name: /提交回報/ });
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByText('回報成功')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('感謝您的填寫')).toBeVisible();
    await expect(page.locator('.pod-hero')).toBeVisible({ timeout: 10_000 });
  });

  test('Pain slider shows correct label at each level', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('回報').click();
    await expect(page.getByText('今日症狀回報')).toBeVisible({ timeout: 5_000 });

    const slider = page.locator('.pain-hero input[type="range"]');
    const label = page.locator('.pain-hero .lvl');

    await slider.fill('0');
    await expect(label).toHaveText('無痛');
    await slider.fill('3');
    await expect(label).toHaveText('輕度疼痛');
    await slider.fill('6');
    await expect(label).toHaveText('中度疼痛');
    await slider.fill('8');
    await expect(label).toHaveText('嚴重疼痛');
    await slider.fill('10');
    await expect(label).toHaveText('劇烈疼痛');
  });

  test('Wound "其他" shows text input field', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('回報').click();
    await expect(page.getByText(/傷口狀況/)).toBeVisible({ timeout: 5_000 });

    const wf = page.locator('.field', { has: page.getByText('傷口狀況') });
    await wf.getByRole('button', { name: '其他' }).click();
    await expect(page.getByPlaceholder('請描述傷口狀況…')).toBeVisible();
    await page.getByPlaceholder('請描述傷口狀況…').fill('發紅');
  });

  test('History page shows reports and chart', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('紀錄').click();
    await expect(page.getByText('恢復歷程')).toBeVisible({ timeout: 5_000 });

    await expect(page.getByText(/共 \d+ 次回報/)).toBeVisible();
    await expect(page.getByText('疼痛分數趨勢')).toBeVisible();
    await expect(page.locator('.chart svg')).toBeVisible();

    const timelineItems = page.locator('.tl-item');
    expect(await timelineItems.count()).toBeGreaterThan(0);
    // Pain value lives in .sym-val .unit = /10
    await expect(timelineItems.first().locator('.sym-val .unit').first()).toHaveText('/10');
  });

  test('History chart range buttons work', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('紀錄').click();
    await expect(page.getByText('疼痛分數趨勢')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: '7D' }).click();
    await page.getByRole('button', { name: 'ALL' }).click();
    await page.getByRole('button', { name: '14D' }).click();
  });

  test('AI Chat — welcome message and quick questions', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('AI 衛教').click();

    await expect(page.locator('.bubble.ai').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/術後衛教 AI 助手/)).toBeVisible();
    await expect(page.getByText(/僅提供衛教資訊/)).toBeVisible();

    await expect(page.getByText('術後疼痛怎麼辦？')).toBeVisible();
    await expect(page.getByText('出血正常嗎？')).toBeVisible();
    await expect(page.getByPlaceholder('輸入您的問題…')).toBeVisible();
  });

  test('AI Chat — send quick question and receive response', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('AI 衛教').click();
    await expect(page.locator('.bubble.ai').first()).toBeVisible({ timeout: 5_000 });

    await page.getByText('術後疼痛怎麼辦？').click();

    await expect(page.locator('.bubble.user').first()).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('.bubble.ai').nth(1)).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.bubble.ai').nth(1)).toContainText('止痛');
  });

  test('AI Chat — custom message via send button', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('AI 衛教').click();
    await expect(page.locator('.bubble.ai').first()).toBeVisible({ timeout: 5_000 });

    const input = page.getByPlaceholder('輸入您的問題…');
    await input.fill('可以吃辣嗎？');
    await page.locator('.chat-send').click();
    await expect(page.locator('.bubble.user').first()).toContainText('可以吃辣嗎？');
    await expect(page.locator('.bubble.ai').nth(1)).toBeVisible({ timeout: 5_000 });
  });

  test('AI Chat — Enter key sends message', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('AI 衛教').click();
    await expect(page.locator('.bubble.ai').first()).toBeVisible({ timeout: 5_000 });

    const input = page.getByPlaceholder('輸入您的問題…');
    await input.fill('發燒怎麼辦');
    await input.press('Enter');
    await expect(page.locator('.bubble.user').first()).toContainText('發燒怎麼辦');
    await expect(page.locator('.bubble.ai').nth(1)).toBeVisible({ timeout: 5_000 });
  });

  test('Quick action buttons navigate', async ({ page }) => {
    await page.getByRole('button', { name: /歷史紀錄/ }).click();
    await expect(page.getByText('恢復歷程')).toBeVisible({ timeout: 5_000 });

    await page.locator('nav.bottom-nav').getByText('首頁').click();
    await expect(page.locator('.pod-hero')).toBeVisible({ timeout: 5_000 });

    await page.locator('.card .btn-row').getByRole('button', { name: /AI 衛教/ }).click();
    await expect(page.getByText(/術後衛教 AI 助手/)).toBeVisible({ timeout: 5_000 });
  });

  test('Sync button refreshes data', async ({ page }) => {
    await page.getByRole('button', { name: /重新同步資料/ }).click();
    await expect(page.locator('.pod-hero')).toBeVisible({ timeout: 5_000 });
  });

  test('Modify today report → SymptomReport', async ({ page }) => {
    const modifyBtn = page.getByRole('button', { name: /修改今日回報/ });
    if (await modifyBtn.isVisible().catch(() => false)) {
      await modifyBtn.click();
      await expect(page.getByText(/今日症狀回報|修改 POD/)).toBeVisible({ timeout: 5_000 });
    }
  });

  test('Bottom nav tabs navigate to all pages', async ({ page }) => {
    await page.locator('nav.bottom-nav').getByText('回報').click();
    await expect(page.getByText('今日症狀回報')).toBeVisible({ timeout: 5_000 });

    await page.locator('nav.bottom-nav').getByText('紀錄').click();
    await expect(page.getByText('恢復歷程')).toBeVisible({ timeout: 5_000 });

    await page.locator('nav.bottom-nav').getByText('AI 衛教').click();
    await expect(page.getByText(/僅提供衛教資訊/)).toBeVisible({ timeout: 5_000 });

    await page.locator('nav.bottom-nav').getByText('首頁').click();
    await expect(page.locator('.pod-hero')).toBeVisible({ timeout: 5_000 });
  });

  test('Theme toggle switches between light and dark', async ({ page }) => {
    const themeBtn = page.locator('nav.bottom-nav button[aria-label="切換主題"]');
    const themeBefore = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await themeBtn.click();
    await expect.poll(async () => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
      .not.toBe(themeBefore);
    await themeBtn.click();
  });

  test('Logout returns to login page', async ({ page }) => {
    await page.getByLabel('登出').click();
    await expect(page.getByText('術後追蹤系統')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByPlaceholder('your@email.com')).toBeVisible();
  });
});
