import { test, expect } from '@playwright/test';

test.describe('Electron App UI', () => {
  test('should display "open a file from the menu"', async ({ page }) => {
    // Navigate to the application with extended waitUntil
    await page.goto('/', { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for the app-welcome component to be visible
    const appWelcome = page.locator('app-welcome');
    await appWelcome.waitFor({ state: 'visible', timeout: 20000 });

    // Verify the text exists (case-insensitive)
    await expect(appWelcome).toContainText(/open a file from the menu/i, {
      timeout: 10000,
    });

    await expect(appWelcome).toContainText(/Recently Opened Files/i, {
      timeout: 10000,
    });
  });
});
