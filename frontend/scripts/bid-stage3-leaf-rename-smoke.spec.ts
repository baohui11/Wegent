// SPDX-License-Identifier: Apache-2.0
// Real-browser smoke for B3: renaming a TOC leaf (an in-document heading) inline
// replaces that heading's text in the body and the TOC follows. tiptap is fully
// mocked under Jest (deriveOutline yields 0 headings there) so this is the gate.
//
// Run: cd frontend && PLAYWRIGHT_CHROMIUM_EXECUTABLE=<chrome> \
//   pnpm exec playwright test scripts/bid-stage3-leaf-rename-smoke.spec.ts \
//   --config playwright.smoke.config.ts
import { test, expect, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  const futureMs = String(Date.now() + 365 * 24 * 3600 * 1000)
  await page.addInitScript((exp: string) => {
    localStorage.setItem(
      'auth_token',
      'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjk5OTk5OTk5OTksInN1YiI6InNtb2tlIn0.'
    )
    localStorage.setItem('auth_token_expire', exp)
  }, futureMs)
})

async function stubSession(page: Page) {
  await page.route('**/users/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, user_name: 'smoke', role: 'user' }),
    })
  )
  await page.route('**/users/me/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  )
  await page.route('**/api/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' })
  )
}

async function gotoStage3(page: Page) {
  await page.goto('/bid-workbench')
  await page.waitForLoadState('domcontentloaded')
  await page.getByTestId('bid-project-list').waitFor({ state: 'visible', timeout: 60_000 })
  await page.getByTestId('bid-project-card-106').click()
  await page.getByTestId('bid-workbench-shell').waitFor({ state: 'visible' })
  await page.getByTestId('bid-stepper-stage-3').click()
  await page.getByTestId('bid-document-editor').waitFor({ state: 'visible' })
  await page.waitForFunction(
    () => {
      const pm = document.querySelector('[data-testid="bid-document-editor"] .ProseMirror') as
        | (HTMLElement & { editor?: { state?: { doc?: { childCount?: number } } } })
        | null
      return !!pm?.editor?.state?.doc && (pm.editor.state.doc.childCount ?? 0) > 0
    },
    { timeout: 30_000 }
  )
}

test('B3: editing a TOC leaf renames the in-document heading', async ({ page }) => {
  page.on('pageerror', err => console.log('PAGEERROR:', String(err).slice(0, 300)))
  await stubSession(page)
  await gotoStage3(page)

  // The seeded project 106 has body headings (e.g. "1.1 系统总体架构" in s1).
  // Find the first heading TOC row, double-click to edit, type a new title.
  const headingRow = page.locator('[data-testid^="bid-generate-heading-"]').first()
  await headingRow.waitFor({ state: 'visible', timeout: 15_000 })
  await headingRow.dblclick()
  const input = page.locator('[data-testid^="bid-generate-heading-edit-"]').first()
  await input.waitFor({ state: 'visible' })
  const NEW = '改名后的小标题ABC'
  await input.fill(NEW)
  await input.press('Enter')

  // The body heading text now contains the new title (editor transaction ran).
  await expect(page.locator('[data-testid="bid-document-editor"]').getByText(NEW)).toBeVisible({
    timeout: 15_000,
  })
  // And the TOC leaf follows (deriveOutline recomputed on the doc update).
  await expect(
    page.locator('[data-testid^="bid-generate-heading-"]').filter({ hasText: NEW })
  ).toBeVisible()
})
