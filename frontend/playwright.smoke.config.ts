// SPDX-License-Identifier: Apache-2.0
// Minimal Playwright config for the bid round-trip fidelity smoke. Production
// E2E config (if any) is separate; this one only drives the single-document
// editor smoke against the mock dev server.
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { defineConfig } from '@playwright/test'

// Resolve a chromium executable: explicit override > system google-chrome >
// the closest cached Playwright headless shell.
const resolveChromium = (): string => {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  try {
    const chrome = execFileSync('sh', ['-c', 'command -v google-chrome'], {
      encoding: 'utf8',
    }).trim()
    if (chrome) return chrome
  } catch {
    /* google-chrome not on PATH */
  }
  const cached = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell`
  return existsSync(cached) ? cached : ''
}

export default defineConfig({
  testDir: './scripts',
  testMatch: /bid-.*smoke\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:3099',
    headless: true,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    launchOptions: {
      // Playwright 1.60 expects chromium build 1223 which isn't in this env's
      // cache; pin launchOptions.executablePath so the smoke runs without a
      // fresh `playwright install` (offline-friendly).
      executablePath: resolveChromium(),
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    // Invoke next dev directly with an explicit port so the dev script's
    // own port negotiation (scripts/dev.cjs ignores --port) doesn't drift.
    command: 'NEXT_PUBLIC_BID_MOCK=1 TURBOPACK=1 npx next dev --turbopack --port 3099',
    url: 'http://localhost:3099/bid-workbench',
    timeout: 120_000,
    reuseExistingServer: true,
    cwd: __dirname,
  },
})
