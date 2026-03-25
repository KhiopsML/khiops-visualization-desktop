import { test, expect } from '@playwright/test';

test.describe('Debug App Loading', () => {
  test('debug - check what loads on the page', async ({ page }) => {
    // Navigate
    await page.goto('/', { waitUntil: 'networkidle', timeout: 30000 });

    // Wait a moment for Angular to fully render
    await page.waitForTimeout(3000);

    // Log all major elements on the page
    const htmlContent = await page.content();
    console.log(
      '📄 Page HTML (first 2000 chars):',
      htmlContent.substring(0, 2000),
    );

    // Check for specific elements
    const appWelcome = page.locator('app-welcome');
    const appWelcomeCount = await appWelcome.count();
    console.log(`📍 Found ${appWelcomeCount} app-welcome elements`);

    const khiopsVisu = page.locator('khiops-visualization');
    const khiopsVisuCount = await khiopsVisu.count();
    console.log(`📍 Found ${khiopsVisuCount} khiops-visualization elements`);

    if (appWelcomeCount > 0) {
      const text = await appWelcome.textContent();
      console.log('📝 app-welcome text:', text);
    }

    // Get all text on the page
    const pageText = await page.textContent('body');
    console.log('📝 Body text (first 500 chars):', pageText?.substring(0, 500));
  });
});
