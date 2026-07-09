// SPDX-License-Identifier: Apache-2.0
// C2 smoke: add/delete chapter UI wiring (real browser, mock backend).
//
// ⚠️ Validation boundary (mock mode):
// - MSW intercepts bid calls at the service worker, so no bid request reaches
//   the network layer and request-watching cannot assert "saveOutlineStage3 was
//   called". We assert the *observable UI wiring* instead.
// - The mock's getDraftSections keys off a fixed SECTION_IDS, so a freshly-added
//   chapter does NOT reliably render in the TOC. The authoritative "new chapter
//   renders + total++" check is the main session's hybrid (real backend)
//   spot-check — NOT verified here.
//
// Observable wiring we CAN assert under mock:
//  - add: button opens the dialog; submit (enabled only with a title) closes it,
//    which proves the onAddChapter handler fired (it closes the dialog).
//  - delete: the per-chapter delete button is present and (on a confirm) the
//    chapter node is removed from the TOC when onDeleteChapter completes.
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

test('C2: add-chapter dialog opens, submit closes it (onAddChapter fired)', async ({ page }) => {
  page.on('pageerror', err => console.log('PAGEERROR:', String(err).slice(0, 300)))
  await stubSession(page)
  await gotoStage3(page)

  // dispatchEvent: an overlay panel intercepts pointer hits on the TOC buttons;
  // dispatching the click fires the React handler directly.
  await page.getByTestId('bid-generate-add-chapter').dispatchEvent('click')
  await expect(page.getByTestId('bid-add-chapter-dialog')).toBeVisible()
  await expect(page.getByTestId('bid-add-chapter-submit')).toBeDisabled()

  await page.getByTestId('bid-add-chapter-name').fill('C2冒烟新增章')
  await expect(page.getByTestId('bid-add-chapter-submit')).toBeEnabled()
  await page.getByTestId('bid-add-chapter-submit').dispatchEvent('click')

  // The submit handler calls onAddChapter then closes the dialog. Closing it is
  // the observable proof the handler ran (it's the last setState in the handler).
  await expect(page.getByTestId('bid-add-chapter-dialog')).not.toBeVisible({
    timeout: 10_000,
  })
})

test('C2: delete-chapter button removes the chapter node from the TOC', async ({ page }) => {
  page.on('pageerror', err => console.log('PAGEERROR:', String(err).slice(0, 300)))
  await stubSession(page)
  await gotoStage3(page)

  const delBtn = page.locator('[data-testid^="bid-generate-delete-chapter-"]').first()
  await delBtn.waitFor({ state: 'visible', timeout: 15_000 })
  // Identify the chapter this button targets.
  const target = await delBtn.getAttribute('data-testid')
  const nodeId = target?.replace('bid-generate-delete-chapter-', '') ?? ''

  page.on('dialog', d => d.accept())
  await delBtn.dispatchEvent('click')
  // onDeleteChapter removes the section from the outline; the TOC node follows.
  await expect(page.getByTestId(`bid-generate-node-${nodeId}`)).toHaveCount(0, {
    timeout: 15_000,
  })
})
