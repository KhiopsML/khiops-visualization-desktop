import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

export const screenshotWindowSize = { width: 1440, height: 1000 };

export default defineConfig({
  ...baseConfig,
  testMatch: 'screenshot-scenario.spec.ts',
  testIgnore: [],
});