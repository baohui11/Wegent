// SPDX-License-Identifier: Apache-2.0

// In-app confirmation modal (design-system styled). Replaces native
// window.confirm, which browsers can silently suppress once the user ticks
// "prevent additional dialogs". Shared by the drafting confirm (Desktop) and
// the materials batch-apply confirm.
export function ConfirmDialog({
  title,
  desc,
  cancel,
  confirm,
  onCancel,
  onConfirm,
}: {
  title: string
  desc: string
  cancel: string
  confirm: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(30,26,24,.25)' }}
      onClick={onCancel}
      data-testid="bid-confirm-dialog"
    >
      <div
        className="w-[340px] rounded-[14px] p-6"
        style={{ background: '#fff', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-2 text-[14.5px] font-bold" style={{ color: 'var(--bid-ink)' }}>
          {title}
        </div>
        <div className="mb-[18px] text-[12.5px]" style={{ color: 'var(--bid-muted)' }}>
          {desc}
        </div>
        <div className="flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-[12.5px]"
            style={{ background: 'var(--bid-paper)', color: 'var(--bid-sub)' }}
          >
            {cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="bid-confirm-ok"
            className="rounded-lg px-4 py-2 text-[12.5px] font-bold text-white"
            style={{ background: 'var(--bid-primary)' }}
          >
            {confirm}
          </button>
        </div>
      </div>
    </div>
  )
}
