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
    // NEXT_DIST_DIR keeps this mock-mode server's build cache out of `.next`;
    // sharing it would make a dev server on :3000 serve mock-mode chunks.
    //
    // A custom distDir makes `next dev` rewrite two tracked files:
    //  * tsconfig.json — NEXT_TSCONFIG_PATH absorbs that write into a git-ignored
    //    throwaway, which must already `extends` the real config or Next creates
    //    a bare one and the `@/*` path aliases stop resolving.
    //  * next-env.d.ts — Next rewrites its distDir reference unconditionally
    //    (writeAppTypeDeclarations has no opt-out) and lands the write after
    //    Playwright tears the server down, so it cannot be restored from here.
    //    It shows up modified after a smoke run; `pnpm dev` rewrites it back.
    //    It stays tracked because CI type-checks with a bare `tsc --noEmit`.
    command: [
      `[ -f tsconfig.smoke.json ] || echo '{ "extends": "./tsconfig.json" }' > tsconfig.smoke.json`,
      'NEXT_PUBLIC_BID_MOCK=1 TURBOPACK=1 NEXT_DIST_DIR=.next-smoke NEXT_TSCONFIG_PATH=tsconfig.smoke.json' +
        ' npx next dev --turbopack --port 3099',
    ].join('; '),
    url: 'http://localhost:3099/bid-workbench',
    timeout: 120_000,
    reuseExistingServer: true,
    cwd: __dirname,
  },
})
