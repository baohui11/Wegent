// SPDX-License-Identifier: Apache-2.0

// Signatures that decide WHEN the single-document editor re-syncs from props.
//
// The editor is the source of truth for its own content (Tiptap's own guidance:
// do not drive it as a controlled component). Props only re-seed it on genuine
// EXTERNAL change. We split that into two independent signals so an autosave —
// which bumps a section's CAS `version` and nothing else — never triggers a
// full document rebuild (the regression where saving reverted the user's edit
// back to the last-fetched body):
//
//   contentSignature — changes only when the set/order of sections or a section
//                      BODY changes (initial load, redraft, regen). Drives the
//                      rebuild-and-reseed path.
//   attrSignature    — changes when a section's `version`/`accepted` changes.
//                      Drives a targeted setNodeAttribute (no rebuild, no caret
//                      loss, no NodeView remount).
//
// Keeping `version`/`accepted` OUT of contentSignature is the whole fix, so it
// is asserted directly in docSync.test.ts.

export interface SectionSyncSpec {
  id: string
  content: string
  version: string
  accepted: boolean
  // Section (chapter) title — an attribute like version/accepted (NOT body), so
  // an outline rename updates the NodeView title via the targeted attr path
  // without a full rebuild.
  title?: string
}

// djb2 — a short, stable digest so a large body doesn't bloat the effect key
// (the key is only used for change detection, never for content addressing).
function digest(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  // Length guards against the (astronomically unlikely) hash collision between
  // two different bodies of different length.
  return `${s.length}.${(h >>> 0).toString(36)}`
}

// Section set + order + body. Excludes version/accepted on purpose.
export function contentSignature(sections: SectionSyncSpec[]): string {
  return sections.map(s => `${s.id}~${digest(s.content)}`).join('|')
}

// Per-section version + accepted + title. Drives targeted attribute updates only.
export function attrSignature(sections: SectionSyncSpec[]): string {
  return sections.map(s => `${s.id}:${s.version}:${s.accepted ? 1 : 0}:${s.title ?? ''}`).join('|')
}
