// SPDX-License-Identifier: Apache-2.0
// Jest mock for the ESM-only `tiptap-markdown` extension. The real package
// exports a Tiptap `Extension` subclass via `Markdown.configure({...})`; in
// tests we only need a stub Extension so the editor's extensions array can be
// constructed. Mapped in jest.config.ts moduleNameMapper.
export const Markdown = {
  configure: (_options?: Record<string, unknown>) => ({ name: 'markdown-stub' }),
}

export default Markdown
