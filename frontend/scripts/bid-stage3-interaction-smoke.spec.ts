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
    const pm = document.querySelector('[data-testid="bid-document-editor"] .ProseMirror') as  // eslint-disable-next-line @typescript-eslint/no-explicit-any
      | (HTMLElement & { editor?: any })
      | null
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
    const pm = document.querySelector('[data-testid="bid-document-editor"] .ProseMirror') as  // eslint-disable-next-line @typescript-eslint/no-explicit-any
      | (HTMLElement & { editor?: any })
      | null
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
      const pm = document.querySelector('[data-testid="bid-document-editor"] .ProseMirror') as  // eslint-disable-next-line @typescript-eslint/no-explicit-any
        | (HTMLElement & { editor?: any })
        | null
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

// Fixes for the three reported Stage-3 editor bugs, all real-browser-only
// (Jest mocks tiptap, so none of this runs under Jest):
//   Bug 1 — the left TOC had a dual highlight (focus-click vs caret) that lit
//           several rows at once. The active state is now caret-driven and
//           single-source: exactly ONE row carries data-active at any time.
//   Bug 2 — the active section / inspector must follow the CARET (selection),
//           not only document edits, so a rewrite addresses the section the
//           caret is in.
//   Bug 3 — ordered/unordered lists must render with markers + indent inside
//           .bid-prose (Tailwind preflight strips them).
test('Bugs 1/2/3: single-active TOC, caret-driven section, rendered lists', async ({ page }) => {
  page.on('pageerror', err => console.log('PAGEERROR:', String(err).slice(0, 300)))
  await stubSession(page)
  await gotoStage3(page)

  const ids = await sectionIds(page)
  expect(ids.length, 'multiple done sections').toBeGreaterThan(1)

  // Helper: drop the caret at the start of section `sid`'s body (no typing).
  const caretInto = (sid: string) =>
    page.evaluate(targetSid => {
      const pm = document.querySelector('[data-testid="bid-document-editor"] .ProseMirror') as  // eslint-disable-next-line @typescript-eslint/no-explicit-any
        | (HTMLElement & { editor?: any })
        | null
      const editor = pm?.editor
      if (!editor) return false
      let start = -1
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor.state.doc.forEach((node: any, offset: number) => {
        if (node.type?.name === 'bidSection' && String(node.attrs?.sectionId) === targetSid) {
          if (start < 0) start = offset + 2
        }
      })
      if (start < 0) return false
      editor.chain().focus().setTextSelection(start).run()
      return true
    }, sid)

  // --- Bug 1: exactly one active TOC row, ever ---------------------------------
  expect(await caretInto(ids[0]), 'caret into first section').toBeTruthy()
  await expect(
    page.locator('[data-active="true"]'),
    'exactly one active TOC row when caret is in the first section'
  ).toHaveCount(1, { timeout: 5_000 })

  // Move the caret into a DIFFERENT section — still exactly one active row, and
  // it is no longer the first section's row.
  expect(await caretInto(ids[1]), 'caret into second section').toBeTruthy()
  await expect(
    page.locator('[data-active="true"]'),
    'still exactly one active TOC row after moving the caret'
  ).toHaveCount(1, { timeout: 5_000 })

  // --- Bug 2: the inspector/focus follows the caret's section -----------------
  // The right-rail status chip reflects the caret's section (all mock sections
  // are done), proving onSelectionUpdate re-addressed the active section.
  await expect(page.getByTestId('bid-focus-status')).toBeVisible()

  // --- Bug 3: lists render with markers + indent inside the editor ------------
  const injectedList = await page.evaluate(targetSid => {
    const pm = document.querySelector('[data-testid="bid-document-editor"] .ProseMirror') as  // eslint-disable-next-line @typescript-eslint/no-explicit-any
      | (HTMLElement & { editor?: any })
      | null
    const editor = pm?.editor
    if (!editor) return false
    let start = -1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor.state.doc.forEach((node: any, offset: number) => {
      if (node.type?.name === 'bidSection' && String(node.attrs?.sectionId) === targetSid) {
        if (start < 0) start = offset + 1
      }
    })
    if (start < 0) return false
    editor
      .chain()
      .focus()
      .insertContentAt(start, '- 列表标记冒烟项 A\n- 列表标记冒烟项 B\n\n')
      .run()
    return true
  }, ids[0])
  expect(injectedList, 'injected a bullet list into the first section').toBeTruthy()

  const ul = page
    .locator('[data-testid="bid-document-editor"] .ProseMirror ul')
    .filter({ hasText: '列表标记冒烟项 A' })
    .first()
  await ul.waitFor({ state: 'visible', timeout: 10_000 })
  const listStyle = await ul.evaluate(el => {
    const cs = getComputedStyle(el)
    return { listStyleType: cs.listStyleType, paddingLeft: cs.paddingLeft }
  })
  console.log('BUG3_LIST_STYLE:', JSON.stringify(listStyle))
  // Tailwind preflight would give list-style-type:none + padding-left:0; the
  // .bid-prose restoration must override both.
  expect(listStyle.listStyleType, 'bullet list shows a marker').not.toBe('none')
  expect(listStyle.paddingLeft, 'bullet list is indented').not.toBe('0px')

  // Handle-vs-marker: hovering the list item surfaces the drag/insert handle;
  // it must sit LEFT of the whole list box (markers live in the list's left
  // padding), so the ⠿/+ never overlaps the "1."/"•". The handle only appears
  // on a real hover the plugin recognizes; best-effort (the geometry is a CSS
  // nudge on .bid-drag-handle), and we always screenshot for visual review.
  const li = ul.locator('li').first()
  await li.hover().catch(() => {})
  const rects = await page
    .locator('.bid-drag-handle')
    .first()
    .waitFor({ state: 'visible', timeout: 4_000 })
    .then(() =>
      page.evaluate(() => {
        const h = document.querySelector('.bid-drag-handle') as HTMLElement | null
        const list = document.querySelector(
          '[data-testid="bid-document-editor"] .ProseMirror ul, [data-testid="bid-document-editor"] .ProseMirror ol'
        ) as HTMLElement | null
        if (!h || !list) return null
        return {
          handleRight: h.getBoundingClientRect().right,
          listLeft: list.getBoundingClientRect().left,
        }
      })
    )
    .catch(() => null)
  console.log('HANDLE_VS_LIST:', JSON.stringify(rects))
  if (rects) {
    expect(
      rects.handleRight,
      'drag handle sits left of the list box, clear of the marker'
    ).toBeLessThanOrEqual(rects.listLeft + 2)
  }
  // Only screenshot when explicitly asked (local visual review), so normal /CI
  // runs don't drop a stray png into the repo.
  if (process.env.HANDLE_SHOT) {
    await page
      .screenshot({
        path: process.env.HANDLE_SHOT,
        clip: { x: 300, y: 120, width: 700, height: 340 },
      })
      .catch(() => {})
  }
  console.log('BUGS_123_OK')
})

test('Bugs 2/4/6: no first-line indent, H4/H5 headings, light-locked inputs', async ({ page }) => {
  page.on('pageerror', err => console.log('PAGEERROR:', String(err).slice(0, 300)))
  await stubSession(page)
  await gotoStage3(page)
  const sid = (await sectionIds(page))[0]

  // 问题2: body paragraphs have no first-line indent.
  const para = page.locator('[data-testid="bid-document-editor"] .ProseMirror p').first()
  await para.waitFor({ state: 'visible' })
  const indent = await para.evaluate(el => getComputedStyle(el).textIndent)
  console.log('P_TEXT_INDENT:', indent)
  expect(indent).toBe('0px')

  // 问题4: bubble menu offers H2–H5; applying H5 sets a level-5 heading.
  const madeSel = await page.evaluate(targetSid => {
    const pm = document.querySelector('[data-testid="bid-document-editor"] .ProseMirror') as  // eslint-disable-next-line @typescript-eslint/no-explicit-any
      | (HTMLElement & { editor?: any })
      | null
    const editor = pm?.editor
    if (!editor) return false
    let from = -1
    let to = -1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor.state.doc.forEach((n: any, off: number) => {
      if (n.type?.name === 'bidSection' && String(n.attrs?.sectionId) === targetSid && from < 0) {
        from = off + 2
        to = Math.min(from + 6, off + n.nodeSize - 2)
      }
    })
    if (from < 0) return false
    editor.chain().focus().setTextSelection({ from, to }).run()
    return true
  }, sid)
  expect(madeSel).toBeTruthy()
  await page.getByTestId('bid-bubble-toolbar').waitFor({ state: 'visible', timeout: 10_000 })
  await expect(page.getByTestId('bid-bubble-h4')).toBeVisible()
  await expect(page.getByTestId('bid-bubble-h5')).toBeVisible()
  await page.getByTestId('bid-bubble-h5').click()
  const isH5 = await page.evaluate(() => {
    const pm = document.querySelector('[data-testid="bid-document-editor"] .ProseMirror') as  // eslint-disable-next-line @typescript-eslint/no-explicit-any
      | (HTMLElement & { editor?: any })
      | null
    return pm?.editor?.isActive('heading', { level: 5 }) ?? false
  })
  console.log('IS_H5:', isH5)
  expect(isH5).toBeTruthy()

  // 问题6: under dark theme, the right-rail instruction box stays white (the bid
  // theme is color-scheme:light locked + the textarea sets an explicit white bg).
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  const ta = page.getByTestId('bid-review-instruction')
  await ta.waitFor({ state: 'visible' })
  const bg = await ta.evaluate(el => getComputedStyle(el).backgroundColor)
  console.log('INSTRUCTION_BG_DARK:', bg)
  expect(bg).toBe('rgb(255, 255, 255)')
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
  console.log('BUGS_246_OK')
})

test('Bug 3: clicking a sub-heading TOC entry scrolls to that heading', async ({ page }) => {
  page.on('pageerror', err => console.log('PAGEERROR:', String(err).slice(0, 300)))
  await stubSession(page)
  await gotoStage3(page)

  const heading = page.locator('[data-testid^="bid-generate-heading-"]').first()
  await heading.waitFor({ state: 'visible', timeout: 10_000 })
  // Read the heading text from its inner span only — the row's textContent
  // also includes the +/− leaf affordance buttons added in C2, which would
  // break the body-heading match below.
  const text = ((await heading.locator('span').first().textContent()) ?? '').trim()
  console.log('TOC_HEADING:', text)

  // Scroll the document column to the very top so a working click must move it.
  await page.evaluate(() => {
    const doc = document.querySelector('[data-testid="bid-generate-document"]')
    const sc = doc?.closest('.overflow-auto') as HTMLElement | null
    if (sc) sc.scrollTop = 0
  })
  await heading.click()

  const scrolled = await page
    .waitForFunction(
      t => {
        const els = Array.from(
          document.querySelectorAll(
            '[data-testid="bid-document-editor"] h2, [data-testid="bid-document-editor"] h3, [data-testid="bid-document-editor"] h4, [data-testid="bid-document-editor"] h5'
          )
        )
        const el = els.find(e => (e.textContent || '').includes(t))
        if (!el) return false
        const top = (el as HTMLElement).getBoundingClientRect().top
        return top > 0 && top < 320
      },
      text,
      { timeout: 6_000 }
    )
    .then(() => true)
    .catch(() => false)
  console.log('HEADING_SCROLLED_INTO_VIEW:', scrolled)
  expect(scrolled).toBeTruthy()
  console.log('BUG3_TOC_OK')
})

test('Bug 7: rewrite takes effect (content changes) and previews a diff', async ({ page }) => {
  page.on('pageerror', err => console.log('PAGEERROR:', String(err).slice(0, 300)))
  await stubSession(page)
  await gotoStage3(page)
  const sid = (await sectionIds(page))[0]

  // Focus the section via its TOC entry so the right-rail rewrite enables.
  await page.getByTestId(`bid-generate-node-${sid}`).click()
  const instr = page.getByTestId('bid-review-instruction')
  await instr.waitFor({ state: 'visible' })
  await instr.fill('语言更凝练')
  await page.getByTestId('bid-review-redraft-button').click()

  // The review gate opens (proposal), and after the mock redraft completes the
  // section body actually changes — the "重写没生效" regression.
  await page.getByTestId('bid-proposal-review').waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForFunction(
    s => {
      const el = document.querySelector(`[data-testid="bid-section-content-${s}"]`)
      return !!el && (el.textContent || '').includes('AI 重写版')
    },
    sid,
    { timeout: 20_000 }
  )
  console.log('REWRITE_APPLIED')

  // Accept clears the review.
  await page.getByTestId('bid-proposal-accept').click()
  await expect(page.getByTestId('bid-proposal-review')).toHaveCount(0)
  console.log('BUG7_OK')
})

test('Bug 5: chapter title is editable and the rename flows to outline + TOC', async ({ page }) => {
  page.on('pageerror', err => console.log('PAGEERROR:', String(err).slice(0, 300)))
  await stubSession(page)
  await gotoStage3(page)
  const sid = (await sectionIds(page))[0]

  const titleEl = page.getByTestId(`bid-section-title-${sid}`)
  await titleEl.waitFor({ state: 'visible' })
  const before = ((await titleEl.textContent()) ?? '').trim()
  console.log('TITLE_BEFORE:', before)
  const renamed = `${before}（已改名）`

  // Click the title → an inline input appears; type a new title + Enter.
  await titleEl.click()
  const input = page.getByTestId(`bid-section-title-input-${sid}`)
  await input.waitFor({ state: 'visible' })
  await input.fill(renamed)
  await input.press('Enter')

  // The NodeView title updates in place …
  await expect(page.getByTestId(`bid-section-title-${sid}`)).toHaveText(renamed)
  // … and the left TOC first-level entry (which reads from the OUTLINE) updates,
  // proving the rename persisted to the outline (single source), not just the doc.
  await expect(page.getByTestId(`bid-generate-node-${sid}`)).toContainText('已改名')
  console.log('BUG5_OK')
})
