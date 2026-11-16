import { defineConfig } from '@playwright/test';
import baseConfig from './screenshot-playwright.config';

export default defineConfig({ ...baseConfig, testMatch: ['menu-probe.spec.ts'] });
