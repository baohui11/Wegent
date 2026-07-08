// SPDX-License-Identifier: Apache-2.0
import { renderHook, act } from '@testing-library/react'
import { bidApis } from '@/apis/bid'
import { useDocumentAutosave } from '@/features/bid/hooks/useDocumentAutosave'

jest.mock('@/apis/bid')

// Build a fake editor whose doc holds N bidSection nodes, each with the given
// markdown body (mirrors what serializeSection would return). The `update`
// handler registered by the hook is invoked via emit('update', { transaction }).
// A transaction with `getMeta('bidSeed') === true` mimics a programmatic
// re-seed (load / version write-back) and MUST NOT trigger a save.
const mkEditor = (sections: Array<{ sid: string; version: string; md: string }>) => {
  const handlers: Record<string, Array<(props: unknown) => void>> = {}
  // Each section node exposes its body markdown via a fake serializer the hook
  // calls through serializeSection. We inject serializeSection's dependency
  // (storage.markdown.serializer.serialize) per-node by stashing the bodies.
  const bodies: Record<string, string> = Object.fromEntries(sections.map(s => [s.sid, s.md]))
  const versions: Record<string, string> = Object.fromEntries(sections.map(s => [s.sid, s.version]))
  const doc = {
    forEach: (cb: (node: unknown, offset: number, index: number) => void) => {
      sections.forEach((s, i) => {
        cb(
          {
            type: { name: 'bidSection' },
            attrs: { sectionId: s.sid, version: s.version },
            // serializeSection reads editor.storage.markdown.serializer.serialize(node);
            // we route it to the per-section body map keyed by node.attrs.sectionId.
          },
          0,
          i
        )
      })
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor: any = {
    storage: {
      markdown: {
        serializer: {
          // Path (a): serialize the node -> its body markdown (test fixture).
          serialize: (node: { attrs: { sectionId: string } }) => bodies[node.attrs.sectionId] ?? '',
        },
      },
    },
    state: { doc },
    on: jest.fn((ev: string, h: (p: unknown) => void) => {
      ;(handlers[ev] ||= []).push(h)
    }),
    off: jest.fn(),
    commands: {
      command: jest.fn((fn: unknown) => {
        // Execute the command closure against a fake tr/state/dispatch so the
        // version write-back path is exercised. setNodeAttribute is recorded.
        const tr = { setNodeAttribute: jest.fn(), setMeta: jest.fn() }
        const state = { doc }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(fn as any)({ tr, state, dispatch: () => {} })
        return true
      }),
    },
  }

  return {
    editor,
    // Update the body fixture for a section (simulates a user edit).
    edit: (sid: string, md: string) => {
      bodies[sid] = md
    },
    setVersion: (sid: string, v: string) => {
      versions[sid] = v
    },
    // Fire the hook's update handler as the editor would.
    emit: (meta?: Record<string, unknown>) => {
      const tx = {
        getMeta: (k: string) => (meta && meta[k] !== undefined ? meta[k] : undefined),
        docChanged: true,
      }
      for (const h of handlers['update'] ?? []) h({ transaction: tx })
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(bidApis.saveSection as jest.Mock).mockImplementation(
    (_pid: number, sid: string, _content: string) => Promise.resolve({ version: `v2-${sid}` })
  )
})

describe('useDocumentAutosave', () => {
  test('saving one section does NOT save the other (per-section CAS)', async () => {
    jest.useFakeTimers()
    const { editor, edit, emit } = mkEditor([
      { sid: 'a', version: 'v1a', md: 'A body' },
      { sid: 'b', version: 'v1b', md: 'B body' },
    ])
    const onSaved = jest.fn()
    const { result } = renderHook(() => useDocumentAutosave({ projectId: 1, editor, onSaved }))
    // Seed snapshots after initial content load so the doc is not "dirty".
    act(() => result.current.seedSnapshots())
    // Genuine edit: change only section A's body, emit a real (non-seed) update.
    edit('a', 'A body EDITED')
    act(() => emit())
    await act(async () => {
      jest.advanceTimersByTime(1600)
      await Promise.resolve()
    })
    expect(bidApis.saveSection).toHaveBeenCalledTimes(1)
    expect(bidApis.saveSection).toHaveBeenCalledWith(1, 'a', 'A body EDITED', 'v1a')
    expect((bidApis.saveSection as jest.Mock).mock.calls.every(c => c[1] !== 'b')).toBe(true)
    jest.useRealTimers()
  })

  test('does NOT save on programmatic seed (no full PUT on entering Edit mode)', async () => {
    // Regression guard: a programmatic re-seed (load / version write-back) emits
    // an update whose transaction carries meta.bidSeed=true. The hook MUST skip
    // it — otherwise merely entering Edit mode would PUT every section (and
    // clobber accepted flags), the exact bug Task 5 prevents.
    jest.useFakeTimers()
    const { editor, emit } = mkEditor([
      { sid: 'a', version: 'v1a', md: 'A body' },
      { sid: 'b', version: 'v1b', md: 'B body' },
    ])
    renderHook(() => useDocumentAutosave({ projectId: 1, editor, onSaved: jest.fn() }))
    // Simulate the load-time setContent transaction (bidSeed=true).
    act(() => emit({ bidSeed: true }))
    await act(async () => {
      jest.advanceTimersByTime(1600)
      await Promise.resolve()
    })
    expect(bidApis.saveSection).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  test('flushSection persists immediately and resolves to the post-save version', async () => {
    jest.useFakeTimers()
    const { editor, edit } = mkEditor([{ sid: 'a', version: 'v1a', md: 'A body' }])
    const onSaved = jest.fn()
    const { result } = renderHook(() => useDocumentAutosave({ projectId: 1, editor, onSaved }))
    act(() => result.current.seedSnapshots())
    edit('a', 'A body EDITED')
    let version = ''
    await act(async () => {
      version = await result.current.flushSection('a')
    })
    expect(bidApis.saveSection).toHaveBeenCalledWith(1, 'a', 'A body EDITED', 'v1a')
    expect(version).toBe('v2-a')
    expect(onSaved).toHaveBeenCalledWith('a', 'v2-a', 'A body EDITED')
    jest.useRealTimers()
  })

  test('a no-op edit (md equals the last snapshot) does not PUT', async () => {
    jest.useFakeTimers()
    const { editor, emit } = mkEditor([{ sid: 'a', version: 'v1a', md: 'A body' }])
    const { result } = renderHook(() =>
      useDocumentAutosave({ projectId: 1, editor, onSaved: jest.fn() })
    )
    // Seed the snapshot baseline first; then an update whose body is unchanged
    // must NOT schedule a save (the dirty check short-circuits in the handler).
    act(() => result.current.seedSnapshots())
    act(() => emit())
    await act(async () => {
      jest.advanceTimersByTime(1600)
      await Promise.resolve()
    })
    expect(bidApis.saveSection).not.toHaveBeenCalled()
    jest.useRealTimers()
  })
})
