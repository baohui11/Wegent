// SPDX-License-Identifier: Apache-2.0
// Generic Jest stub for Tiptap 3 extension packages. Each Tiptap extension is
// used as `Foo.configure({...})` and as an array entry in useEditor's
// `extensions`; since useEditor itself is mocked in component tests, the
// extensions only need to exist as objects with a `configure()` factory.
// Mapped in jest.config.ts for @tiptap/starter-kit and @tiptap/extension-*.
const make = (name: string) => ({
  name,
  configure: () => ({ name }),
})

export default make('tiptap-extension-default')
export const StarterKit = make('starter-kit')
export const Link = make('link')
export const Image = make('image')
export const Table = make('table')
export const TableRow = make('table-row')
export const TableCell = make('table-cell')
export const TableHeader = make('table-header')
