import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

export default defineConfig({
  ...baseConfig,
  testMatch: 'screenshot-scenario.spec.ts',
  testIgnore: [],
});