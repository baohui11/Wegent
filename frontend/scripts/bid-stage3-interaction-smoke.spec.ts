// SPDX-License-Identifier: Apache-2.0
//
// Real-browser smoke for the Stage-3 editor interaction refinements that Jest
// cannot exercise (tiptap is fully mocked under Jest):
//   B3 — the selection bubble's ↻ opens an instruction popover that SURVIVES
//        focusing/typing in its textarea (the editor blurs → shouldShow must
//        keep the bubble shown), and regenerates only on submit.
//   A4 — the left TOC derives in-document headings live: injecting an H2 into a
//        section body makes a new heading sub-entry appear, and section entries
//        carry a [data-bid-section] scroll anchor.
//
// Runs against the mock dev server (NEXT_PUBLIC_BID_MOCK=1) with seeded project
// 106 (all sections done). Same harness as bid-roundtrip-smoke.spec.ts.
//
// Run: cd frontend && PLAYWRIGHT_CHROMIUM_EXECUTABLE=<chrome> \
//   pnpm exec playwright test scripts/bid-stage3-interaction-smoke.spec.ts \
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

// Stub the non-bid session calls so the SPA mounts under mock mode.
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

// Reach Stage 3 (the single-document generate/refine editor) of project 106.
async function gotoStage3(page: Page) {
  await page.goto('/bid-workbench')
  await page.waitForLoadState('domcontentloaded')
  await page.getByTestId('bid-project-list').waitFor({ state: 'visible', timeout: 60_000 })
  await page.getByTestId('bid-project-card-106').click()
  await page.getByTestId('bid-workbench-shell').waitFor({ state: 'visible' })
  await page.getByTestId('bid-stepper-stage-3').click()
  await page.getByTestId('bid-document-editor').waitFor({ state: 'visible' })
  // Wait for the ProseMirror editor instance + at least one bidSection to load.
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

// The first N bidSection ids present in the document.
async function sectionIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const pm = document.querySelector(
      '[data-testid="bid-document-editor"] .ProseMirror'
    ) as // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (HTMLElement & { editor?: any }) | null
    const ids: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pm?.editor?.state?.doc?.forEach((n: any) => {
      if (n.type?.name === 'bidSection') ids.push(String(n.attrs?.sectionId ?? ''))
    })
    return ids
  })
}

test('B3: ↻ opens an instruction popover that survives typing, regenerates on submit', async ({
  page,
}) => {
  page.on('pageerror', err => console.log('PAGEERROR:', String(err).slice(0, 300)))
  await stubSession(page)
  await gotoStage3(page)

  const ids = await sectionIds(page)
  console.log('SECTION_IDS:', JSON.stringify(ids))
  expect(ids.length, 'at least one done section').toBeGreaterThan(0)
  const sid = ids[0]

  // Select a few characters inside the first section's body and focus, which is
  // what makes the format BubbleMenu appear (shouldShow: focused + non-empty).
  const sel = await page.evaluate(targetSid => {
    const pm = document.querySelector(
      '[data-testid="bid-document-editor"] .ProseMirror'
    ) as // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (HTMLElement & { editor?: any }) | null
    const editor = pm?.editor
    if (!editor) return { ok: false }
    let from = -1
    let to = -1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor.state.doc.forEach((node: any, offset: number) => {
      if (
        node.type?.name === 'bidSection' &&
        String(node.attrs?.sectionId) === targetSid &&
        from < 0
      ) {
        from = offset + 2
        to = Math.min(from + 6, offset + node.nodeSize - 2)
      }
    })
    if (from < 0 || to <= from) return { ok: false }
    editor.chain().focus().setTextSelection({ from, to }).run()
    return { ok: true, from, to }
  }, sid)
  console.log('SELECTION:', JSON.stringify(sel))
  expect(sel.ok, 'made a non-empty selection in the section body').toBeTruthy()

  // The format bubble appears above the selection.
  await page.getByTestId('bid-bubble-toolbar').waitFor({ state: 'visible', timeout: 10_000 })
  const regen = page.getByTestId('bid-bubble-regen')
  await regen.waitFor({ state: 'visible' })

  // Clicking ↻ opens the instruction popover — it must NOT regenerate yet.
  await regen.click()
  const panel = page.getByTestId('bid-bubble-regen-panel')
  await panel.waitFor({ state: 'visible', timeout: 5_000 })
  // No proposal review yet (nothing submitted).
  expect(await page.getByTestId('bid-proposal-review').count()).toBe(0)

  // THE KEY CHECK: focus + type in the textarea. The editor blurs; the bubble
  // (and thus the popover) must stay visible thanks to shouldShow's regenOpen.
  const box = page.getByTestId('bid-bubble-regen-instruction')
  await box.click()
  await box.fill('语言更凝练')
  await expect(panel, 'popover survives focusing/typing in its textarea').toBeVisible()
  expect(await box.inputValue()).toBe('语言更凝练')

  // Submit → the popover closes and the section enters the 🅒 review gate.
  await page.getByTestId('bid-bubble-regen-submit').click()
  await expect(panel).toBeHidden({ timeout: 5_000 })
  await page.getByTestId('bid-proposal-review').waitFor({ state: 'visible', timeout: 10_000 })
  console.log('B3_OK: popover survived typing, submit opened the review gate')
})

test('A4: injecting an H2 into a section body adds a live heading sub-entry to the TOC', async ({
  page,
}) => {
  page.on('pageerror', err => console.log('PAGEERROR:', String(err).slice(0, 300)))
  await stubSession(page)
  await gotoStage3(page)

  const ids = await sectionIds(page)
  const sid = ids[0]
  console.log('A4_TARGET_SID:', sid)

  // Section entries carry a scroll anchor (fixes ①).
  expect(
    await page.locator(`[data-bid-section="${sid}"]`).count(),
    'section has a [data-bid-section] scroll anchor'
  ).toBeGreaterThan(0)

  // Headings present on load (the seed body may already contain them).
  const before = await page.locator('[data-testid^="bid-generate-heading-"]').count()
  console.log('HEADINGS_BEFORE:', before)

  // Inject a distinctive H2 at the start of the section body via the editor's
  // own markdown parser (same path the editor uses for markdown insertion).
  const MARKER = 'A4冒烟实时标题'
  const inj = await page.evaluate(
    ({ targetSid, marker }) => {
      const pm = document.querySelector(
        '[data-testid="bid-document-editor"] .ProseMirror'
      ) as // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (HTMLElement & { editor?: any }) | null
      const editor = pm?.editor
      if (!editor) return { ok: false }
      let start = -1
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor.state.doc.forEach((node: any, offset: number) => {
        if (
          node.type?.name === 'bidSection' &&
          String(node.attrs?.sectionId) === targetSid &&
          start < 0
        ) {
          start = offset + 1
        }
      })
      if (start < 0) return { ok: false }
      editor.chain().focus().insertContentAt(start, `## ${marker}\n\n`).run()
      return { ok: true, start }
    },
    { targetSid: sid, marker: MARKER }
  )
  console.log('A4_INJECT:', JSON.stringify(inj))
  expect(inj.ok).toBeTruthy()

  // The left TOC must show the new heading as a sub-entry (derived live).
  await expect(
    page.locator('[data-testid^="bid-generate-heading-"]').filter({ hasText: MARKER }),
    'injected H2 appears as a live TOC sub-entry'
  ).toHaveCount(1, { timeout: 10_000 })
  console.log('A4_OK: injected heading appeared in the left TOC')

  // Clicking the heading sub-entry scrolls without error (the anchor resolves).
  await page
    .locator('[data-testid^="bid-generate-heading-"]')
    .filter({ hasText: MARKER })
    .first()
    .click()
  console.log('A4_SCROLL_OK: heading entry click did not throw')
})
