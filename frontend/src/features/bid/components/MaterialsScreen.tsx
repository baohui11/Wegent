// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import { bidApis, type AttachmentInfo } from '@/apis/bid'
import { JsonEditor } from './JsonEditor'
import { AttachmentUploader } from './AttachmentUploader'

const DEFAULT_KB = { bidder_knowledge_base: {} }
const DEFAULT_QUALS = { company: '', items: {} }

async function loadOrDefault<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback // GET returns 409 until first save
  }
}

export function MaterialsScreen({
  projectId,
  onComplete,
}: {
  projectId: number
  onComplete: () => void
}) {
  const { t } = useTranslation('bidWorkbench')
  const [kb, setKb] = useState<Record<string, unknown>>(DEFAULT_KB)
  const [quals, setQuals] = useState<Record<string, unknown>>(DEFAULT_QUALS)
  const [attachments, setAttachments] = useState<AttachmentInfo[]>([])
  const [ready, setReady] = useState(false)

  const refreshAttachments = async () =>
    setAttachments((await bidApis.listAttachments(projectId)).items)

  useEffect(() => {
    let alive = true
    void (async () => {
      const kbRes = await loadOrDefault(() => bidApis.getKnowledgeBase(projectId), {
        knowledge_base: DEFAULT_KB,
      })
      const qRes = await loadOrDefault(() => bidApis.getQualifications(projectId), {
        qualifications: DEFAULT_QUALS,
      })
      const at = await loadOrDefault(() => bidApis.listAttachments(projectId), {
        items: [] as AttachmentInfo[],
      })
      if (!alive) return
      setKb(kbRes.knowledge_base)
      setQuals(qRes.qualifications)
      setAttachments(at.items)
      setReady(true)
    })()
    return () => {
      alive = false
    }
  }, [projectId])

  if (!ready) return null

  return (
    <div
      className="flex h-full flex-col gap-6 overflow-auto p-6"
      data-testid="bid-materials-screen"
    >
      <div className="grid grid-cols-2 gap-6">
        <div className="flex flex-col gap-2">
          <JsonEditor label="kb" value={kb} onValidChange={setKb} />
          <button
            type="button"
            onClick={() => bidApis.saveKnowledgeBase(projectId, kb)}
            data-testid="bid-save-kb-button"
            className="self-start rounded-lg border border-primary px-4 py-2 text-sm text-primary"
          >
            {t('phase3.save_kb')}
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <JsonEditor label="quals" value={quals} onValidChange={setQuals} />
          <button
            type="button"
            onClick={() => bidApis.saveQualifications(projectId, quals)}
            data-testid="bid-save-quals-button"
            className="self-start rounded-lg border border-primary px-4 py-2 text-sm text-primary"
          >
            {t('phase3.save_quals')}
          </button>
        </div>
      </div>
      <AttachmentUploader
        projectId={projectId}
        items={attachments}
        onUploaded={refreshAttachments}
      />
      <div className="text-right">
        <button
          type="button"
          onClick={onComplete}
          data-testid="bid-materials-complete-button"
          className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white"
        >
          {t('phase3.complete')}
        </button>
      </div>
    </div>
  )
}
