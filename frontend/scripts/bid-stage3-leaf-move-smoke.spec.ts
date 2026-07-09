// SPDX-License-Identifier: Apache-2.0
// C3 smoke: leaf move up/down within a chapter (real browser, mock backend).
//
// ⚠️ Validation boundary: this is the riskiest editor code (slice→delete→insert
// + tr.mapping.map). Only verifiable in a real browser (tiptap is fully mocked
// under Jest → 0 headings). MSW intercepts bid calls, so we assert the
// *observable editor effect*: two same-level headings swap order in the body.
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

// The text of the first two same-level headings in the editor body, in order.
async function firstTwoHeadingTexts(page: Page): Promise<[string, string] | null> {
  return page.evaluate(() => {
    const pm = document.querySelector('[data-testid="bid-document-editor"] .ProseMirror') as
      | (HTMLElement & { editor?: unknown })
      | null
    type EditorLike = {
      state?: {
        doc?: {
          descendants?: (
            cb: (n: { type?: { name?: string }; textContent?: string }) => boolean | void
          ) => void
        }
      }
    }
    const editor = pm?.editor as EditorLike | undefined
    const texts: string[] = []
    editor?.state?.doc?.descendants?.(n => {
      if (n.type?.name === 'heading' && typeof n.textContent === 'string') {
        texts.push(n.textContent.trim())
      }
      return texts.length < 2
    })
    return texts.length >= 2 ? ([texts[0], texts[1]] as [string, string]) : null
  })
}

test('C3: moving the first leaf down swaps two same-level headings', async ({ page }) => {
  page.on('pageerror', err => console.log('PAGEERROR:', String(err).slice(0, 300)))
  await stubSession(page)
  await gotoStage3(page)

  const before = await firstTwoHeadingTexts(page)
  expect(before).not.toBeNull()
  const [a, b] = before as [string, string]

  const downBtn = page.locator('[data-testid^="bid-generate-leaf-down-"]').first()
  await downBtn.waitFor({ state: 'visible', timeout: 15_000 })
  await downBtn.dispatchEvent('click')

  // After moving the first leaf down, the first two headings swap.
  await expect.poll(firstTwoHeadingTexts.bind(null, page), { timeout: 15_000 }).toEqual([b, a])
})
