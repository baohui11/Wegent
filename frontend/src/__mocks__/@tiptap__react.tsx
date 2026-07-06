// SPDX-License-Identifier: Apache-2.0
// Shared Jest mock for @tiptap/react. ProseMirror cannot run under jsdom in our
// test setup (Schema/Selection rely on real DOM layout), so every test that
// transitively renders the bid document editor needs useEditor stubbed. Mapped globally
// via jest.config.ts moduleNameMapper so individual test files don't each have
// to declare it.
//
// Tests can drive the editor by mutating `__mockEditor` (the current instance)
// — e.g. set `__mockEditor.storage.markdown.getMarkdown` to a fixture string,
// or `__mockEditor.state.selection.$from.index` to a top-level block index —
// then fire `__lastEditorConfig.current.onUpdate(...)`.
import React from 'react'

interface EditorConfig {
  editable?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onUpdate?: (props: { editor: any }) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export const __lastEditorConfig: { current: EditorConfig | null } = { current: null }

// The single mock editor instance tests can mutate to drive behavior.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const __mockEditor: any = {
  isEditable: true,
  setEditable: jest.fn(),
  commands: {
    setContent: jest.fn(),
    // `command(fn)` runs a raw ProseMirror command closure against
    // { tr, state, dispatch }. Production code (document population, version
    // write-back) uses this; the mock executes the closure against a minimal
    // fake tr/state so the path runs under Jest.
    command: jest.fn((fn: unknown) => {
      const tr = {
        setNodeAttribute: jest.fn(),
        setMeta: jest.fn(),
        replaceWith: jest.fn(),
        doc: { content: { size: 0 } },
      }
      // Provide a schema stub that hands the JSON back wrapped as a node whose
      // .content the production path reads. Real schema behavior is verified
      // in the Task 9 browser smoke; here we only need the closure to run.
      const schema = {
        nodeFromJSON: (json: unknown) => ({
          content: (json as { content?: unknown[] })?.content ?? [],
        }),
      }
      const state = { doc: { forEach: (_cb: unknown) => {} }, schema }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (fn as any)({ tr, state, dispatch: () => {} })
    }),
  },
  storage: {
    markdown: {
      getMarkdown: () => '',
      // Per-section serializer (spike path a) + markdown parser used by the
      // document-assembly layer. Tests override these to drive behavior.
      serializer: { serialize: () => '' },
      parser: {
        parse: (_md: string) => ({ toJSON: () => ({ content: [{ type: 'paragraph' }] }) }),
      },
    },
  },
  // editor.on/off store handlers in __events keyed by event name so tests can
  // fire them (the autosave hook subscribes via editor.on('update', ...)).
  __events: {} as Record<string, Array<(props: unknown) => void>>,
  on: jest.fn(function (this: typeof __mockEditor, ev: string, h: (p: unknown) => void) {
    ;(this.__events[ev] ||= []).push(h)
  }),
  off: jest.fn(function (this: typeof __mockEditor, ev: string, h: (p: unknown) => void) {
    const arr = this.__events[ev]
    if (arr) this.__events[ev] = arr.filter(x => x !== h)
  }),
  emit: function (this: typeof __mockEditor, ev: string, props?: unknown) {
    for (const h of this.__events[ev] ?? []) h(props)
  },
  destroy: jest.fn(),
  state: {
    selection: { $from: { index: (depth: number) => (depth === 0 ? 0 : 0), depth: 0 } },
    doc: { forEach: (_cb: unknown) => {} },
  },
  // chain() records command names so insert-toolbar tests can assert calls.
  // All chain() invocations share one persistent __chainCalls log; each method
  // access returns a callable that records its name and returns the builder.
  __chainCalls: [] as string[],
  chain: function () {
    const calls = __mockEditor.__chainCalls as string[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = new Proxy(
      function () {
        return builder
      },
      {
        get(_t, prop: string) {
          if (prop === 'run') return () => true
          // Every other method: record the name and stay chainable. Calling
          // it (with any args) also returns builder.
          calls.push(prop)
          return (..._args: unknown[]) => builder
        },
      }
    )
    return builder
  },
}

export function useEditor(config: EditorConfig) {
  __lastEditorConfig.current = config
  return __mockEditor
}

export function EditorContent() {
  return React.createElement('div', { 'data-testid': 'bid-section-editor' })
}

// NodeView primitives used by React NodeViews (BidSectionNodeView). In tests
// they are plain passthrough wrappers that forward props (incl. data-testid /
// contentEditable) so a NodeView can be rendered directly against a hand-built
// { node, extension } and asserted by testid.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function NodeViewWrapper(props: any) {
  return React.createElement('div', props, props.children)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function NodeViewContent(props: any) {
  const { as = 'div', children, ...rest } = props
  return React.createElement(as as string, rest, children)
}
// ReactNodeViewRenderer just wraps the component; under the mock it returns a
// marker so addNodeView() is exercised without a real ProseMirror NodeView.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ReactNodeViewRenderer(component: any) {
  return { __nodeView: true, component }
}
// ReactNodeViewProps is a type-only export; re-declared here for the type
// position used by component signatures. Erased at runtime.
export type ReactNodeViewProps = {
  node: { attrs: Record<string, unknown> }
  extension: { options: Record<string, unknown> }
  // Permissive index signature keeps the type compatible with extra fields.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
} & Record<string, unknown>

// Assign to a variable before exporting as default (lint: no-anonymous-default-export).
const tipTapReactMock = {
  useEditor,
  EditorContent,
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
  __mockEditor,
  __lastEditorConfig,
}

export default tipTapReactMock
