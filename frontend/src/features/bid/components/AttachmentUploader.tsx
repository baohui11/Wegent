// SPDX-License-Identifier: Apache-2.0

import type { ChangeEvent } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import { bidApis, type AttachmentInfo } from '@/apis/bid'

interface Props {
  projectId: number
  items: AttachmentInfo[]
  onUploaded: () => void
}

export function AttachmentUploader({ projectId, items, onUploaded }: Props) {
  const { t } = useTranslation('bidWorkbench')
  const onSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await bidApis.uploadAttachment(projectId, file)
    e.target.value = ''
    onUploaded()
  }
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-semibold">{t('phase3.attachments')}</label>
      <input
        type="file"
        onChange={onSelect}
        data-testid="bid-attachment-input"
        className="text-sm"
      />
      <ul className="flex flex-col gap-1 text-sm" data-testid="bid-attachment-list">
        {items.map(a => (
          <li
            key={a.name}
            className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1"
          >
            <span aria-hidden>📎</span>
            <span className="flex-1 truncate">{a.name}</span>
            <span className="text-text-muted">{a.size} B</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
