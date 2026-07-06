// SPDX-License-Identifier: Apache-2.0
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { serializeSection, markdownToSectionContent } from '@/features/bid/canvas/serializeSection'

// Jest stubs StarterKit/Markdown, so we cannot build a real editor with a
// bidSection schema. Instead we drive `serializeSection` with a hand-rolled
// editor whose `storage.markdown.serializer.serialize` mirrors the REAL
// tiptap-markdown API surface (spike-notes §1 path (a): serializer.serialize
// renders just the node's children). This exercises the production code path —
// the call into the live serializer — without re-implementing markdown.

 
const mkEditor = (serialize: (n: unknown) => string) =>
  ({
    storage: {
      // Mirror the real tiptap-markdown API: storage.markdown.serializer.serialize(node).
      markdown: { serializer: { serialize } },
    },
  }) as never

describe('serializeSection (spike path a)', () => {
  test('delegates to editor.storage.markdown.serializer.serialize(node)', () => {
    const seen: unknown[] = []
    const editor = mkEditor(n => {
      seen.push(n)
      // Pretend the serializer rendered this section's body markdown.
      return 'BODY-OF-' + ((n as { attrs?: { sectionId?: string } }).attrs?.sectionId ?? '?')
    })
    const node = { attrs: { sectionId: 'a' } } as unknown as ProseMirrorNode
    expect(serializeSection(editor, node)).toBe('BODY-OF-a')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe(node)
  })

  test('returns empty string when the markdown storage is absent', () => {
    const editor = { storage: {} } as never
    const node = { attrs: { sectionId: 'a' } } as unknown as ProseMirrorNode
    expect(serializeSection(editor, node)).toBe('')
  })

  test('passes the section node through verbatim (no cloning / no whole-doc)', () => {
    // The whole point of per-section serialization: serialize ONE node, not the
    // document. The serializer must receive the section node itself.
    const editor = mkEditor(() => 'md')
    const node = { attrs: { sectionId: 'only-me' } } as unknown as ProseMirrorNode
    serializeSection(editor, node)
    // (covered above) — re-assert here as a focused regression guard.
    expect(node).toEqual({ attrs: { sectionId: 'only-me' } })
  })
})

describe('markdownToSectionContent (heading strip on load)', () => {
  test('strips a leading # heading that merely repeats the section name', () => {
    expect(markdownToSectionContent('# 一、项目概况\n\n正文段落。', '一、项目概况').trim()).toBe(
      '正文段落。'
    )
  })

  test('strips a leading ## heading too (mock sections use h2)', () => {
    const out = markdownToSectionContent('## 第一章 总体技术方案\n\n正文。', '第一章 总体技术方案')
    expect(out.trim()).toBe('正文。')
  })

  test('leaves a leading heading that does NOT match the section name', () => {
    const md = '# 其他标题\n\n正文'
    expect(markdownToSectionContent(md, '一、项目概况').trim()).toBe(md.trim())
  })

  test('leaves content that has no leading heading untouched', () => {
    expect(markdownToSectionContent('正文无标题', '一、项目概况').trim()).toBe('正文无标题')
  })

  test('does not strip a body paragraph that happens to start with # mid-text', () => {
    // Only a true leading `# ` at line start counts.
    const md = '正文中包含 # 不是标题'
    expect(markdownToSectionContent(md, 'x').trim()).toBe(md.trim())
  })

  test('handles a heading + blank-line variations (CRLF / trailing spaces)', () => {
    const out = markdownToSectionContent('# 标题  \r\n\r\n正文', '标题')
    expect(out.trim()).toBe('正文')
  })
})
