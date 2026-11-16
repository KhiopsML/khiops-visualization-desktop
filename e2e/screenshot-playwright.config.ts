import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

export default defineConfig({
  ...baseConfig,
  testMatch: [
    'screenshot-scenario.spec.ts',
    // 'screenshot-scenario-helper.spec.ts',
  ],
  testIgnore: [],
});
