// SPDX-License-Identifier: Apache-2.0
// C2 smoke: leaf (in-document heading) add/delete (real browser, mock backend).
//
// ⚠️ Validation boundary: these are editor (tiptap) operations — only verifiable
// in a real browser, never under Jest (deriveOutline yields 0 headings there).
// MSW intercepts bid calls, so request-watching cannot assert redraftRange was
// called. We assert the *observable editor effect* instead: a new heading
// appears in the body after add; the heading's range disappears after delete.
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

test('C2: adding a leaf inserts a new ## heading in the body', async ({ page }) => {
  page.on('pageerror', err => console.log('PAGEERROR:', String(err).slice(0, 300)))
  await stubSession(page)
  await gotoStage3(page)

  const addLeaf = page.locator('[data-testid^="bid-generate-leaf-add-"]').first()
  await addLeaf.waitFor({ state: 'visible', timeout: 15_000 })

  const NEW = 'C2冒烟新增小节XYZ'
  // window.prompt is the leaf-title input; accept with the new title.
  page.on('dialog', d => d.accept(NEW))
  await addLeaf.dispatchEvent('click')

  // The editor inserted `## <NEW>` (plus a placeholder paragraph) in the body.
  await expect(page.locator('[data-testid="bid-document-editor"]').getByText(NEW)).toBeVisible({
    timeout: 15_000,
  })
})

test('C2: deleting a leaf removes its heading range from the body', async ({ page }) => {
  page.on('pageerror', err => console.log('PAGEERROR:', String(err).slice(0, 300)))
  await stubSession(page)
  await gotoStage3(page)

  // Capture the target heading's text so we can assert it is gone after delete.
  const headingRow = page.locator('[data-testid^="bid-generate-heading-"]').first()
  await headingRow.waitFor({ state: 'visible', timeout: 15_000 })
  const headingText = (await headingRow.textContent()) ?? ''
  expect(headingText.trim().length).toBeGreaterThan(0)

  page.on('dialog', d => d.accept()) // window.confirm
  await page.locator('[data-testid^="bid-generate-leaf-del-"]').first().dispatchEvent('click')

  // The deleted heading's text no longer appears in the body.
  await expect(
    page.locator('[data-testid="bid-document-editor"]').getByText(headingText.trim())
  ).toHaveCount(0, { timeout: 15_000 })
})
