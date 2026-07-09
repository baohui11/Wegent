// SPDX-License-Identifier: Apache-2.0
// C3 smoke: chapter reorder (real browser, mock backend).
//
// ⚠️ Validation boundary: the mock's getDraftSections keys off a fixed
// SECTION_IDS, so the editor's section order may NOT reflect the new outline
// order under pure mock mode. This smoke asserts the UI WIRING — that a down-
// move click fires onMoveChapter and the stage-3 outline (chapter list) follows.
// The authoritative "document rebuilds in the new order" check is the main
// session's hybrid (real backend) spot-check.
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

// The stage-3 top-level chapter order, as rendered in the left TOC. The
// `bid-generate-node-` prefix is shared by chapters and nested children, so we
// key off the reorder buttons (only present on depth-0 chapters) instead.
async function chapterOrder(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const btns = Array.from(
      document.querySelectorAll('[data-testid^="bid-generate-move-chapter-down-"]')
    )
    return btns
      .map(b => b.getAttribute('data-testid')?.replace('bid-generate-move-chapter-down-', '') ?? '')
      .filter(Boolean)
  })
}

test('C3: moving a chapter down reorders the stage-3 chapter list', async ({ page }) => {
  page.on('pageerror', err => console.log('PAGEERROR:', String(err).slice(0, 300)))
  await stubSession(page)
  await gotoStage3(page)

  const before = await chapterOrder(page)
  expect(before.length).toBeGreaterThan(1)

  // dispatchEvent: an overlay panel intercepts pointer hits on the TOC buttons
  // (see C2). Dispatching the click fires the React handler directly.
  const downBtn = page.locator(`[data-testid="bid-generate-move-chapter-down-${before[0]}"]`)
  await downBtn.waitFor({ state: 'visible', timeout: 15_000 })
  await downBtn.dispatchEvent('click')

  // The stage-3 outline (chapter list) swaps the first two chapters.
  await expect.poll(async () => (await chapterOrder(page))[0], { timeout: 15_000 }).toBe(before[1])
})
