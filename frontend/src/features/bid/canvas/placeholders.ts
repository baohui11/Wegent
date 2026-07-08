// SPDX-License-Identifier: Apache-2.0

// Placeholder recognition for subproject 🅓. Bid bodies come back from the
// backend with unfilled markers the user must resolve before export:
//   {{qual:资质证书}} / {{bidder}}   — structured bindings (resolved at assembly)
//   [待填项目名称]                    — bracketed to-fill
//   待填(来源:企业营业执照)           — "to fill" with an optional source hint
// We turn each occurrence into an atomic inline `bidPlaceholder` node so it
// renders as a non-editable chip, can be counted, and round-trips back to its
// exact source text on save (the node's markdown.serialize emits `raw`).

// Order matters: {{...}} and [待填...] are tried before the bare `待填(...)`
// alternative so a bracketed/braced form is never split mid-token.
export const PLACEHOLDER_RE = /\{\{[^}]+\}\}|\[待填[^\]]*\]|待填(?:[（(][^）)]*[）)])?/g

// Human-facing chip label (the node keeps the verbatim `raw` for serialization):
// {{qual:资质证书}} -> 资质证书, {{bidder}} -> bidder, [待填X] -> 待填X, 待填(...) -> 待填.
export function chipLabel(raw: string): string {
  if (raw.startsWith('{{') && raw.endsWith('}}')) {
    const inner = raw.slice(2, -2).trim()
    const colon = inner.indexOf(':')
    return colon >= 0 ? inner.slice(colon + 1).trim() : inner
  }
  if (raw.startsWith('[') && raw.endsWith(']')) return raw.slice(1, -1).trim()
  return '待填'
}

interface TextNode {
  type: 'text'
  text: string
  marks?: unknown
}

// Split one text string into an inline sequence of text + bidPlaceholder JSON
// nodes. Marks (bold/italic/…) carry onto the surrounding text parts, never onto
// the placeholder (a chip is styled by its NodeView, not by inline marks).
function splitText(text: string, marks: unknown): unknown[] {
  const out: unknown[] = []
  const re = new RegExp(PLACEHOLDER_RE) // fresh instance: lastIndex is per-call
  let last = 0
  let m: RegExpExecArray | null
  const push = (t: string) => {
    if (!t) return
    const node: TextNode = { type: 'text', text: t }
    if (marks) node.marks = marks
    out.push(node)
  }
  while ((m = re.exec(text)) !== null) {
    push(text.slice(last, m.index))
    out.push({ type: 'bidPlaceholder', attrs: { raw: m[0] } })
    last = m.index + m[0].length
  }
  push(text.slice(last))
  if (out.length === 0) {
    // No text and no match (empty string) — preserve the original node.
    const node: TextNode = { type: 'text', text }
    if (marks) node.marks = marks
    return [node]
  }
  return out
}

// Recursively rewrite a block-content JSON array, replacing placeholder runs in
// every text node with bidPlaceholder inline nodes. Pure — unit-tested without a
// live editor (the real schema round-trip is covered by the Playwright smoke).
export function injectPlaceholders(content: unknown[]): unknown[] {
  return content.flatMap(node => {
    const n = node as { type?: string; text?: string; marks?: unknown; content?: unknown[] }
    if (n.type === 'text' && typeof n.text === 'string') return splitText(n.text, n.marks)
    if (Array.isArray(n.content)) return [{ ...n, content: injectPlaceholders(n.content) }]
    return [node]
  })
}

// Count placeholder nodes in a block-content JSON tree (used in tests; the live
// editor counts via editor.state.doc — see BidDocumentEditor).
export function countPlaceholdersInJson(content: unknown[]): number {
  let n = 0
  for (const node of content) {
    const x = node as { type?: string; content?: unknown[] }
    if (x.type === 'bidPlaceholder') n++
    else if (Array.isArray(x.content)) n += countPlaceholdersInJson(x.content)
  }
  return n
}
