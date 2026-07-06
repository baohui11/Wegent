# Spike Notes — Bid Single-Document Foundation (Task 1)

> Date: 2026-07-06
> Status: **Conclusive** — unblocks Task 3 and Task 6.
> Method: source-code reading of installed `tiptap-markdown@0.9.0`, `prosemirror-markdown@1.13.1`, and the backend `bid` services. Runtime empirical verification is blocked by the Jest environment (which mocks all of ProseMirror/TipTap) and by pnpm strict-hoisting for standalone Node scripts; the source-level evidence below is authoritative and unambiguous.

---

## Conclusion A / B for the assembler (Step 3 + Step 4)

### Step 3 — Assembler title source: **CONCLUSION B (titles read from `.md` body)**

The export assembler reads section headings from the **`.md` body**, not from the outline.

Evidence (`backend/app/services/bid/vendor/skills/bid-assembler/scripts/assemble_bid.py`):

- `add_markdown()` (lines 464–523) scans every line of `final/<sid>.md`. The branch at **lines 502–507** matches `^(#{1,4})\s+(.+)$` and calls `doc.add_heading(clean(heading.group(2)), level=len(heading.group(1)))`. So a body line `# 总述` becomes a Word `Heading 1` in the docx.
- `main()` (lines 568–580) iterates `outline["sections"]` **only to set section order** and to locate the `{id}.md` file; it does **not** add a heading from `outline[*].title`. The title is consumed purely from the body via `add_markdown`.
- The outline-driven heading in `main()` (line 593, `doc.add_heading(vol_name, level=1)`) applies **only to standalone volumes** (商务/资格/报价), not to the main technical sections.

Confirmed by the existing test `backend/tests/services/bid/test_assemble.py`:

- `_seed()` writes `workspace/sections/s1.md` = `"# 总述\n\n本项目由{{bidder}}实施…"` (line 29) — i.e. the `.md` **starts with a `# 总述` heading**.
- `test_finalize_produces_valid_docx` (lines 57–71) asserts the resulting docx has a heading containing `总述`. That heading can only come from the body `# 总述` line — proving the assembler relies on the body heading.

**Implication for the foundation refactor:** the title currently lives in the `.md` body because the assembler puts it there. If we strip the heading from the body (the §6 spec goal: title rendered once, by the NodeView), the **assembler would drop the heading from the export** unless we change the assembler to add the heading from the outline. So **Conclusion B applies** → the plan's 「后端对齐子任务」 is required, not optional.

Also note `bid.mock.ts` mirrors the same convention: `SECTION_CONTENT.s1` starts with `## 第一章 总体技术方案` (the body carries the heading).

### Step 4 — Does `redraft-range` assume the body starts with a title heading? **No hard assumption, but line numbers are body-relative.**

Evidence (`backend/app/services/bid/draft_pipeline.py:319-361` `redraft_range` + `specialists.py:489-529` `rewrite_excerpt`):

- `redraft_range` reads `content = ds.read_section(ws, section_id)`, splits on `\n`, and replaces lines `[s-1:e]` (1-indexed inclusive). **Line numbers are byte-relative to the on-disk `.md` file**, whatever its first line happens to be.
- `rewrite_excerpt` is handed `full_section=content` as context plus `excerpt=lines[s-1:e]`. Its prompt (`specialists.py:489-493`) says "下面给出某一节的完整内容作为上下文 … 请仅改写目标片段". It treats the section as opaque context; it does **not** assume line 1 is a title. Removing the title line would not corrupt the prompt.

**Implication:** removing the title from the stored `.md` shifts all body line numbers **down by the number of stripped title lines** (currently the title + its trailing blank line = 2 lines). This is safe **only if** the frontend computes `blockLineRange` against the **same title-less body it sends to `PUT /sections/:sid/content`**. Since the frontend (a) strips the title on load, (b) serializes the title-less body on save, and (c) maps the cursor block to a line range on the title-less body, the frontend's line numbers will be **consistent with the bytes the backend stores**. The backend alignment subtask must additionally make `redraft_one` (full-section redraft via `call_ghostwriter`) also emit a **title-less** body so the convention is uniform — see 「Backend alignment subtask」 below.

---

## Step 1 — `serializeSection` implementation path: **PATH (a)**

`tiptap-markdown`'s serializer can serialize a **single node**, not just the whole doc. **Path (a) is the chosen implementation**: `editor.storage.markdown.serializer.serialize(sectionNode)`.

Evidence (`frontend/node_modules/tiptap-markdown/src/serialize/MarkdownSerializer.js`):

```js
serialize(content) {                                  // line 18
  const state = new MarkdownSerializerState(this.nodes, this.marks, { ... });
  state.renderContent(content);                       // line 23 — renders ANY node
  return state.out;
}
```

- `getMarkdown()` (`src/Markdown.js:45-47`) is just sugar: `serializer.serialize(this.editor.state.doc)`. Passing a child node instead of the doc serializes only that node's subtree.
- `renderContent(parent)` (prosemirror-markdown `dist/index.cjs:802-808`) iterates `parent.forEach((node, _, i) => this.render(node, parent, i))` — so serializing a `bidSection` node renders exactly its child blocks.

**Chosen `serializeSection` implementation (replaces plan Task 3 Step 3 fallback):**

```ts
// Serialize ONLY the given bidSection node's body. Path (a): the live
// MarkdownSerializer.renderContent(node) renders just that node's children.
export function serializeSection(editor: Editor, node: ProseMirrorNode): string {
  const storage = (editor.storage as { markdown?: MarkdownStorage }).markdown
  return storage?.serializer.serialize(node) ?? ''
}
```

Why (a) over the plan's fallback (c) (throwaway temp editor): (a) reuses the **live editor's** serializer, so serialization rules are guaranteed identical to `getMarkdown()`; (c) requires constructing a second `Editor` from `extensionManager.extensions`, which is heavier and can diverge (e.g. if a NodeView-bearing extension misbehaves when re-instantiated). (a) is strictly better.

The `MarkdownStorage` type gains a `serializer` field for path (a):

```ts
interface MarkdownStorage {
  getMarkdown(): string
  serializer: { serialize(node: ProseMirrorNode): string }
}
```

`markdownToSectionContent(md, sectionName)` is unchanged from the plan: strip a leading `#`-heading equal to `sectionName` (and its trailing blank line) on load.

## Step 2 — How a custom wrapper node participates in serialization

`tiptap-markdown` discovers each node's serializer via `extension.storage.markdown.serialize` (see `src/util/extensions.js` `getMarkdownSpec`). To make `bidSection` emit **only its children with no wrapper syntax**, the node provides:

```ts
addStorage() {
  return {
    markdown: {
      // Render only this section's children; emit NO wrapper syntax and NO title
      // (the title is rendered once by the NodeView from the outline name).
      serialize(state, node) {
        state.renderContent(node)
      },
    },
  }
}
```

`state.renderContent(node)` is the documented prosemirror-markdown primitive for "render this node's children" — identical to how `serialize(doc)` works at the top level, just scoped to the section. No wrapper tokens, no fence, no heading.

---

## Plan adjustments forced by these conclusions

1. **Task 2 (`bidSection` node)** — `group` must be the schema's top-level content group. The spec/plan said `group: 'bidSectionGroup'` with a custom `doc` allowing only `bidSection+`. TipTap v3 + StarterKit: the default `Document` node allows `block+`. The cleanest no-backward-compat approach (per AGENTS.md guideline #10) is to ship a **custom `Document`** extension whose `content` is `'bidSection+'` (so users literally cannot type outside a section), and give `bidSection` `group: 'bidSectionGroup'` so only `bidSection` satisfies the doc's `content` spec. This keeps the doc strictly `bidSection+` and matches the spec §4 ("顶层文档 = Document 只允许 bidSection+"). The plan's Task 2 node definition stays the same; Task 7 additionally wires a custom `Document` extension (overriding StarterKit's bundled one via `StarterKit.configure({ document: false })`).
2. **Task 3 (`serializeSection`)** — implement Path (a) as above (replaces fallback (c)). **Signature unchanged** (`serializeSection(editor, node): string`).
3. **Task 6 (`blockRange`)** — `blockLineRange(md, idx)` is fed the **title-less** body markdown (from `serializeSection`), so line numbers are consistent with the title-less bytes the backend will store after the alignment subtask. No change to `blockLineRange` itself; only `topBlockIndexOf` becomes section-local (already in the plan).
4. **Backend alignment subtask — REQUIRED (Conclusion B).** Concrete changes:
   - `assemble_bid.py::main()` must, for each outline section, emit a heading from `sec["title"]` (Word heading level matching the outline depth) **before** calling `add_markdown` on the (now title-less) body. Add a depth→level mapping. The volume-heading block (line 593) is unaffected.
   - `draft_pipeline.py` / ghostwriter output: the stored `.md` must no longer start with a title heading. Adjust the ghostwriter instruction (`specialists.py::call_ghostwriter`, the `_GW_PROMPT` "只返回本节正文 markdown") to explicitly say "不要以章节标题开头；标题由系统从大纲注入". This keeps `redraft_one` consistent with the new on-disk convention so `redraft_range` line numbers stay well-defined.
   - `post_gate.py::check_section` operates on the body text; it does not assume a title line (it counts chars, checks `must_keep` substrings, checks ```` ```figure ````). Safe under the change.
   - Tests: update `backend/tests/services/bid/test_assemble.py` seed bodies to be title-less (drop the leading `# 总述` / `# 质量` lines), and assert the assembler now produces the heading from `outline["sections"][*]["title"]`. Add a case proving a title-less body + outline title still yields a docx with the heading.
   - `bid.mock.ts`: update `SECTION_CONTENT.*` to drop the leading `## 第…章` line (mock must mirror the new backend convention so Read-mode and Edit-mode render the title only via the NodeView).

## Spike deviations / things to flag to the reviewer

- **No live runtime round-trip number was captured.** Jest mocks ProseMirror entirely (see `jest.config.ts` lines 28–41: `@tiptap/react`, `tiptap-markdown`, `@tiptap/starter-kit`, and the `@tiptap/extension-*` catch-all are all stubbed), so the bid test suite verifies behavior through a **mock editor** (`src/__mocks__/@tiptap__react.tsx`) rather than real serialization. A standalone Node script couldn't load the real packages due to pnpm strict hoisting + ESM/CJS interop between `tiptap-markdown` (UMD that `require('@tiptap/core')` internally) and `@tiptap/core` (ESM-primary). The conclusions above rest on reading the installed source directly, which is unambiguous; Task 3's test will assert the real behavior via the mock-editor contract (the mock's `storage.markdown.serializer.serialize` will mirror the real API surface so the production code path is exercised).
- **Mock plumbing already present.** The handoff said "GenerateRefineScreen.test.tsx 当前 mock 里缺 saveSection/redraftRange". Both are already mocked in that file (lines 191, 225). Task 8 will adapt these mocks to the single-document editor, not add them from scratch.
- **`EnhancedMarkdown` removal.** Two `GenerateRefineScreen.test.tsx` cases (lines 68–113) explicitly assert that Read mode renders via `EnhancedMarkdown` (checking for the `react-markdown-mock` testid). Task 8 must rewrite these to assert the single-document editor in read mode instead; the tests will change shape, not just mock data.
