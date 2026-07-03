// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState, type ReactNode } from 'react'
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

function Card({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-2xl p-5"
      style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
    >
      <div>
        <div className="text-sm font-bold" style={{ color: 'var(--bid-ink)' }}>
          {title}
        </div>
        <div className="mt-0.5 text-xs" style={{ color: 'var(--bid-muted)' }}>
          {hint}
        </div>
      </div>
      {children}
    </div>
  )
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

  const progress = useMemo(() => {
    const kbInner = (kb.bidder_knowledge_base as Record<string, unknown>) ?? kb
    const kbFilled = !!kbInner && Object.keys(kbInner).length > 0
    const company = (quals.company as string) ?? ''
    const items = (quals.items as Record<string, unknown>) ?? {}
    const qualsFilled = !!company.trim() || Object.keys(items).length > 0
    const attFilled = attachments.length > 0
    const done = [kbFilled, qualsFilled, attFilled].filter(Boolean).length
    return {
      pct: Math.round((done / 3) * 100),
      rows: [
        { label: t('materials.c_kb'), ok: kbFilled },
        { label: t('materials.c_quals'), ok: qualsFilled },
        { label: t('materials.c_attachments'), ok: attFilled },
      ],
    }
  }, [kb, quals, attachments, t])

  if (!ready) return null

  return (
    <div
      className="flex h-full gap-6 overflow-auto p-6"
      style={{ background: 'var(--bid-paper)' }}
      data-testid="bid-materials-screen"
    >
      {/* Main: material editors */}
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <Card title={t('materials.kb_title')} hint={t('materials.kb_hint')}>
          <JsonEditor label="kb" value={kb} onValidChange={setKb} />
          <button
            type="button"
            onClick={() => bidApis.saveKnowledgeBase(projectId, kb)}
            data-testid="bid-save-kb-button"
            className="self-start rounded-lg px-4 py-2 text-sm font-semibold"
            style={{ border: '1px solid var(--bid-primary)', color: 'var(--bid-primary)' }}
          >
            {t('phase3.save_kb')}
          </button>
        </Card>

        <Card title={t('materials.quals_title')} hint={t('materials.quals_hint')}>
          <JsonEditor label="quals" value={quals} onValidChange={setQuals} />
          <button
            type="button"
            onClick={() => bidApis.saveQualifications(projectId, quals)}
            data-testid="bid-save-quals-button"
            className="self-start rounded-lg px-4 py-2 text-sm font-semibold"
            style={{ border: '1px solid var(--bid-primary)', color: 'var(--bid-primary)' }}
          >
            {t('phase3.save_quals')}
          </button>
        </Card>

        <Card title={t('materials.attachments_title')} hint={t('materials.attachments_hint')}>
          <AttachmentUploader
            projectId={projectId}
            items={attachments}
            onUploaded={refreshAttachments}
          />
        </Card>
      </div>

      {/* Right: completeness + deferred requirements */}
      <div className="flex w-[280px] flex-shrink-0 flex-col gap-4">
        <div
          className="flex flex-col gap-3 rounded-2xl p-5"
          style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
        >
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold" style={{ color: 'var(--bid-ink)' }}>
              {t('materials.completeness')}
            </div>
            <div className="text-lg font-extrabold" style={{ color: 'var(--bid-primary)' }}>
              {progress.pct}%
            </div>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full"
            style={{ background: 'var(--bid-primary-soft)' }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progress.pct}%`, background: 'var(--bid-primary)' }}
            />
          </div>
          <div className="flex flex-col gap-2">
            {progress.rows.map(r => (
              <div key={r.label} className="flex items-center justify-between text-xs">
                <span style={{ color: 'var(--bid-sub)' }}>{r.label}</span>
                <span style={{ color: r.ok ? 'var(--bid-success)' : 'var(--bid-muted-2)' }}>
                  {r.ok ? `✓ ${t('materials.done')}` : t('materials.todo')}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div
          className="rounded-2xl p-5"
          style={{ background: 'var(--bid-paper-2)', border: '1px dashed var(--bid-border-2)' }}
        >
          <div className="mb-1 text-sm font-bold" style={{ color: 'var(--bid-ink-2)' }}>
            {t('materials.requirements_title')}
          </div>
          <div className="text-xs" style={{ color: 'var(--bid-muted)' }}>
            {t('materials.requirements_soon')}
          </div>
        </div>

        <button
          type="button"
          onClick={onComplete}
          data-testid="bid-materials-complete-button"
          className="rounded-xl px-5 py-3 text-sm font-bold text-white"
          style={{ background: 'var(--bid-primary)' }}
        >
          {t('phase3.complete')}
        </button>
      </div>
    </div>
  )
}
