import { defineConfig } from '@playwright/test';
import baseConfig from './screenshot-playwright.config';

export default defineConfig({
  ...baseConfig,
  testMatch: ['screenshot-scenario-helper.spec.ts'],
});
