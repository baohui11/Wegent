// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { bidThemeVars } from '@/features/bid/theme'
import { bidApis } from '@/apis/bid'

type PickedFile = {
  name: string
  size: number
  text: string
  status: 'extracting' | 'ready' | 'error'
  error?: string
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const SAMPLE_NAME = '智慧园区建设项目招标文件.txt'

export function UploadScreen({
  onCreate,
  onBack,
  sampleText,
}: {
  // tenderText: concatenated content of the picked files; name: '' means the
  // backend derives it from the tender during parsing (smart naming); model:
  // '' means use the global default (BID_TENDER_MODEL_NAME).
  onCreate: (tenderText: string, name: string, model: string) => void
  onBack: () => void
  sampleText: string
}) {
  const { t } = useTranslation('bidWorkbench')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<PickedFile[]>([])
  const [nameMode, setNameMode] = useState<'manual' | 'smart'>('manual')
  const [name, setName] = useState('')
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [model, setModel] = useState('')

  // Load available models once (best-effort; a fetch failure just leaves the
  // dropdown empty, which means "use global default").
  useEffect(() => {
    bidApis
      .listModels()
      .then(res => setModelOptions((res.items ?? []).map(m => m.name)))
      .catch(() => {
        /* leave empty -> use global default */
      })
  }, [])

  const onFilesSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || [])
    if (fileInputRef.current) fileInputRef.current.value = ''
    for (const f of picked) {
      const entry: PickedFile = { name: f.name, size: f.size, text: '', status: 'extracting' }
      setFiles(prev => [...prev, entry])
      try {
        const out = await bidApis.extractTenderText(f)
        setFiles(prev =>
          prev.map(x => (x === entry ? { ...x, text: out.text, status: 'ready' } : x))
        )
      } catch (err) {
        setFiles(prev =>
          prev.map(x =>
            x === entry
              ? { ...x, status: 'error', error: err instanceof Error ? err.message : 'error' }
              : x
          )
        )
      }
    }
  }

  const loadSample = () => {
    setFiles(prev => [
      ...prev,
      {
        name: SAMPLE_NAME,
        size: new Blob([sampleText]).size,
        text: sampleText,
        status: 'ready' as const,
      },
    ])
  }

  const removeFile = (idx: number) => setFiles(prev => prev.filter((_, i) => i !== idx))

  const readyFiles = files.filter(f => f.status === 'ready')
  const hasPending = files.some(f => f.status === 'extracting')
  const hasFiles = files.length > 0
  const canCreate =
    readyFiles.length > 0 && !hasPending && (nameMode === 'smart' || name.trim().length > 0)

  const submit = () => {
    if (!canCreate) return
    const tenderText = readyFiles.map(f => f.text).join('\n\n')
    onCreate(tenderText, nameMode === 'manual' ? name.trim() : '', model.trim())
  }

  const tab = (active: boolean): React.CSSProperties => ({
    flex: 1,
    textAlign: 'center',
    fontSize: 12.5,
    fontWeight: 700,
    padding: '8px 0',
    borderRadius: 7,
    cursor: 'pointer',
    background: active ? '#fff' : 'transparent',
    color: active ? 'var(--bid-primary)' : 'var(--bid-muted-2)',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
  })

  return (
    <div
      className="h-full overflow-auto"
      style={{
        background: 'radial-gradient(circle at 50% -10%, #FBEAEA 0%, #F7F6F4 50%)',
        position: 'relative',
      }}
      data-testid="bid-upload-screen"
    >
      <button
        type="button"
        onClick={onBack}
        data-testid="bid-upload-back-button"
        className="absolute flex items-center gap-1.5"
        style={{
          top: 24,
          left: 28,
          cursor: 'pointer',
          color: 'var(--bid-sub)',
          fontSize: 13,
          fontWeight: 600,
          padding: '8px 14px',
          border: '1px solid var(--bid-border-2)',
          borderRadius: 9,
          background: '#fff',
          zIndex: 2,
        }}
      >
        ← {t('upload.back_to_workbench')}
      </button>

      <div
        className="mx-auto flex flex-col items-center"
        style={{ maxWidth: 600, padding: '76px 24px 64px' }}
      >
        <div
          className="flex items-center justify-center font-black text-white"
          style={{
            width: 60,
            height: 60,
            borderRadius: 15,
            background: 'var(--bid-primary)',
            fontSize: 24,
            marginBottom: 18,
          }}
        >
          标
        </div>
        <div style={{ fontSize: 23, fontWeight: 800, marginBottom: 7 }}>{t('upload.heading')}</div>
        <div
          className="text-center"
          style={{ fontSize: 13.5, color: 'var(--bid-muted)', marginBottom: 30 }}
        >
          {t('upload.subtitle')}
        </div>

        <div
          className="w-full"
          style={{
            background: '#fff',
            border: '1px solid var(--bid-border)',
            borderRadius: 16,
            padding: 24,
            boxShadow: '0 8px 30px rgba(20,16,14,.06)',
          }}
        >
          {/* Tender files */}
          <div className="flex items-baseline justify-between" style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--bid-ink-2)' }}>
              {t('upload.files_header')}
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: 'var(--bid-muted-2)',
                  marginLeft: 6,
                }}
              >
                {t('upload.files_hint')}
              </span>
            </div>
            <span
              onClick={loadSample}
              data-testid="bid-upload-sample-button"
              style={{
                fontSize: 11.5,
                color: 'var(--bid-primary)',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              {t('upload.load_sample')}
            </span>
          </div>

          <div
            onClick={() => fileInputRef.current?.click()}
            data-testid="bid-upload-dropzone"
            style={{
              border: '1.5px dashed #D9B7BB',
              borderRadius: 12,
              padding: 24,
              textAlign: 'center',
              cursor: 'pointer',
              background: 'var(--bid-paper-2)',
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 6 }}>📄</div>
            <div style={{ fontSize: 13, color: 'var(--bid-sub)' }}>{t('upload.dropzone')}</div>
            <div style={{ fontSize: 11, color: 'var(--bid-muted-3)', marginTop: 4 }}>
              {t('upload.dropzone_hint')}
            </div>
          </div>
          <input
            type="file"
            multiple
            accept=".txt,.md,.markdown,.docx,.pdf"
            ref={fileInputRef}
            onChange={onFilesSelected}
            data-testid="bid-tender-file"
            className="hidden"
          />

          {hasFiles && (
            <div className="flex flex-col gap-2" style={{ marginTop: 12 }}>
              {files.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-2.5"
                  style={{
                    background: 'var(--bid-paper-2)',
                    border: '1px solid #EFE9E5',
                    borderRadius: 9,
                    padding: '9px 11px',
                  }}
                >
                  <span
                    className="flex flex-shrink-0 items-center justify-center"
                    style={{
                      width: 26,
                      height: 30,
                      background: 'var(--bid-primary-soft)',
                      borderRadius: 5,
                      fontSize: 12,
                    }}
                  >
                    📄
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate"
                      style={{ fontSize: 12, fontWeight: 600, color: 'var(--bid-ink-2)' }}
                    >
                      {f.name}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--bid-muted-2)', marginTop: 1 }}>
                      {fmtSize(f.size)} ·{' '}
                      {f.status === 'extracting' && (
                        <span style={{ color: 'var(--bid-muted-2)' }}>
                          {t('upload.file_extracting')}
                        </span>
                      )}
                      {f.status === 'ready' && (
                        <span style={{ color: 'var(--bid-success)' }}>
                          {t('upload.file_ready')}
                        </span>
                      )}
                      {f.status === 'error' && (
                        <span style={{ color: '#B3453D' }}>
                          {f.error || t('upload.file_error')}
                        </span>
                      )}
                    </div>
                  </div>
                  <span
                    onClick={() => removeFile(i)}
                    className="flex flex-shrink-0 items-center justify-center"
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      color: '#B3453D',
                      fontSize: 14,
                      cursor: 'pointer',
                    }}
                  >
                    ×
                  </span>
                </div>
              ))}
              <div style={{ fontSize: 11, color: 'var(--bid-muted-2)' }}>
                {t('upload.files_added', { count: files.length })}
              </div>
            </div>
          )}

          <div style={{ height: 1, background: '#EFE9E5', margin: '22px 0 18px' }} />

          {/* Project name */}
          <div
            style={{ fontSize: 13, fontWeight: 800, color: 'var(--bid-ink-2)', marginBottom: 10 }}
          >
            {t('upload.name_header')}
          </div>
          <div
            className="flex gap-1.5"
            style={{ background: '#F1EEEB', borderRadius: 9, padding: 3, marginBottom: 12 }}
          >
            <div
              onClick={() => setNameMode('manual')}
              data-testid="bid-name-mode-manual"
              style={tab(nameMode === 'manual')}
            >
              ✍ {t('upload.name_manual')}
            </div>
            <div
              onClick={() => setNameMode('smart')}
              data-testid="bid-name-mode-smart"
              style={tab(nameMode === 'smart')}
            >
              ✦ {t('upload.name_smart')}
            </div>
          </div>

          {nameMode === 'manual' ? (
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('upload.name_manual_placeholder')}
              data-testid="bid-project-name-input"
              className="w-full"
              style={{
                boxSizing: 'border-box',
                border: '1px solid var(--bid-border-2)',
                borderRadius: 10,
                padding: '12px 14px',
                fontSize: 13,
                outline: 'none',
                background: '#fff',
                color: 'var(--bid-ink)',
              }}
            />
          ) : (
            <div style={{ fontSize: 12, color: 'var(--bid-muted)', lineHeight: 1.6 }}>
              {t('upload.name_smart_desc')}
            </div>
          )}

          <div
            style={{
              fontSize: 13,
              fontWeight: 800,
              color: 'var(--bid-ink-2)',
              marginTop: 18,
              marginBottom: 10,
            }}
          >
            {t('upload.model_label')}
          </div>
          <Select
            value={model || 'default'}
            onValueChange={v => setModel(v === 'default' ? '' : v)}
          >
            <SelectTrigger
              data-testid="bid-model-select"
              className="h-11 w-full gap-2 rounded-lg border-border bg-surface px-3.5 text-[13px] text-text-primary"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent style={bidThemeVars}>
              <SelectItem value="default">{t('upload.model_default')}</SelectItem>
              {modelOptions.map(n => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <button
            type="button"
            onClick={submit}
            disabled={!canCreate}
            data-testid="bid-start-parse-button"
            className="w-full text-white disabled:opacity-50"
            style={{
              background: 'var(--bid-primary)',
              borderRadius: 10,
              padding: '13px 20px',
              fontSize: 14,
              fontWeight: 700,
              cursor: canCreate ? 'pointer' : 'not-allowed',
              marginTop: 16,
            }}
          >
            {t('upload.create')}
          </button>
          {!hasFiles && (
            <div
              className="text-center"
              style={{ fontSize: 11, color: 'var(--bid-muted-3)', marginTop: 9 }}
            >
              {t('upload.create_hint')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
