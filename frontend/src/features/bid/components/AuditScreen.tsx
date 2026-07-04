// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import { bidApis, type AuditReport } from '@/apis/bid'

const COVERS = [
  { id: 'std', band: 'var(--bid-primary)' },
  { id: 'dark', band: 'var(--bid-ink)' },
  { id: 'light', band: 'var(--bid-primary-soft)' },
] as const

// Stage 5: quality audit + typography/export in one screen.
export function AuditScreen({
  projectId,
  finalized = false,
  finalizing = false,
  onRework,
  onFinalize,
  onLocate,
}: {
  projectId: number
  finalized?: boolean
  finalizing?: boolean
  onRework: () => void
  onFinalize: () => void
  // Jump back to Stage 4 (review) to locate an issue in the document body.
  onLocate?: () => void
}) {
  const { t } = useTranslation('bidWorkbench')
  const [report, setReport] = useState<AuditReport | null>(null)
  const [running, setRunning] = useState(true)
  const [nonce, setNonce] = useState(0)
  const [verifying, setVerifying] = useState(false)
  const [layoutTab, setLayoutTab] = useState<'upload' | 'text'>('text')
  const [layoutText, setLayoutText] = useState('')
  const [cover, setCover] = useState<string>('std')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const layoutFileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let alive = true
    setRunning(true)
    void bidApis.runAudit(projectId).then(r => {
      if (!alive) return
      setReport(r)
      setRunning(false)
    })
    return () => {
      alive = false
    }
  }, [projectId, nonce])

  const verify = async () => {
    setVerifying(true)
    try {
      setReport(await bidApis.verifyAudit(projectId))
    } finally {
      setVerifying(false)
    }
  }
  const download = async () => {
    setDownloadError(null)
    setDownloading(true)
    try {
      await bidApis.downloadBid(projectId)
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : 'unknown')
    } finally {
      setDownloading(false)
    }
  }

  const issues = useMemo(
    () =>
      (report?.checks ?? []).flatMap(c =>
        c.issues.map(i => ({
          level: i.veto ? 'veto' : i.severity === 'high' ? 'high' : 'medium',
          text: i.desc,
        }))
      ),
    [report]
  )

  if (running || !report) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm"
        style={{ background: 'var(--bid-paper)', color: 'var(--bid-sub)' }}
        data-testid="bid-audit-running"
      >
        {t('phase6.running')}
      </div>
    )
  }

  const veto = report.verdict === 'NEED_FIX_VETO'
  const verdictColor =
    report.verdict === 'PASS'
      ? 'var(--bid-success)'
      : veto
        ? 'var(--bid-primary)'
        : 'var(--bid-warn)'
  const s = report.summary
  const okChecks = report.checks.filter(c => c.ok).length
  const integrity = report.checks.length ? Math.round((okChecks / report.checks.length) * 100) : 0

  return (
    <div className="flex h-full overflow-auto" data-testid="bid-audit-screen">
      {/* Left: integrity / consistency / risk */}
      <div
        className="flex w-[264px] flex-shrink-0 flex-col gap-4 p-4"
        style={{ borderRight: '1px solid var(--bid-border)' }}
      >
        <Card>
          <div className="mb-3 text-center text-xs font-bold" style={{ color: 'var(--bid-sub)' }}>
            {t('phase6.integrity_title')}
          </div>
          <Donut pct={integrity} label={`${integrity}`} unit={t('phase6.score_unit')} />
          <div className="mt-2.5 text-center text-[11px]" style={{ color: 'var(--bid-muted-2)' }}>
            {t('phase6.coverage')}: {s.scoring_coverage}
          </div>
          <div
            className="mt-1 rounded px-2 py-0.5 text-center text-xs font-extrabold text-white"
            style={{ background: verdictColor }}
            data-testid="bid-audit-verdict"
          >
            {t(`phase6.verdict_${report.verdict}`)}
          </div>
        </Card>

        <Card>
          <div className="mb-3 text-center text-xs font-bold" style={{ color: 'var(--bid-sub)' }}>
            {t('phase6.consistency_title')}
          </div>
          <Donut pct={88} label="88" unit={t('phase6.score_unit')} />
          <div className="mt-2.5 flex flex-col gap-1">
            {(
              [
                ['phase6.term_consistency', '92%'],
                ['phase6.data_consistency', '85%'],
                ['phase6.format_consistency', '87%'],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between text-[10.5px]">
                <span style={{ color: 'var(--bid-muted)' }}>{t(k)}</span>
                <span style={{ color: 'var(--bid-ink-2)' }}>{v}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="mb-2.5 text-xs font-bold" style={{ color: 'var(--bid-sub)' }}>
            {t('checks.risk_title')}
          </div>
          <div
            className="text-center text-[26px] font-extrabold"
            style={{ color: 'var(--bid-primary)' }}
          >
            {s.total_issues}
          </div>
          <div className="mb-2.5 text-center text-[11px]" style={{ color: 'var(--bid-muted-2)' }}>
            {t('phase6.risk_unit')}
          </div>
          <div className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--bid-sub)' }}>
            <div>
              <span style={{ color: 'var(--bid-primary)' }}>●</span> {t('checks.veto')}:{' '}
              {s.veto_issues}
            </div>
            <div>
              <span style={{ color: 'var(--bid-warn)' }}>●</span> {t('checks.high')}:{' '}
              {s.high_issues}
            </div>
          </div>
        </Card>
      </div>

      {/* Center: compliance table + issues + actions */}
      <div className="min-w-[480px] flex-1 overflow-auto px-5 py-4">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="text-[13px] font-extrabold" style={{ color: 'var(--bid-ink)' }}>
            {t('phase6.compliance')}
          </div>
          <div className="flex gap-2">
            <SmallBtn onClick={verify} disabled={verifying} testid="bid-audit-verify-button">
              {verifying ? t('phase6.verifying') : t('phase6.deep_verify')}
            </SmallBtn>
            <SmallBtn onClick={() => setNonce(n => n + 1)} testid="bid-audit-rerun-button">
              {t('phase6.rerun')}
            </SmallBtn>
            <SmallBtn onClick={onRework} testid="bid-audit-rework-button" accent>
              {t('phase6.rework')}
            </SmallBtn>
          </div>
        </div>

        <div
          className="mb-4 overflow-hidden rounded-xl"
          style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
        >
          <div
            className="grid grid-cols-[2.4fr_0.7fr_1.4fr] px-4 py-2.5 text-[10.5px] font-bold"
            style={{ background: 'var(--bid-paper-2)', color: 'var(--bid-muted-2)' }}
          >
            <div>{t('checks.col_check')}</div>
            <div>{t('checks.col_status')}</div>
            <div>{t('checks.col_result')}</div>
          </div>
          {report.checks.map(c => (
            <div
              key={c.check}
              className="border-b px-4 py-2.5"
              style={{ borderColor: 'var(--bid-border)' }}
              data-testid={`bid-audit-check-${c.check}`}
            >
              <div className="grid grid-cols-[2.4fr_0.7fr_1.4fr] items-center">
                <span className="text-xs" style={{ color: 'var(--bid-ink-2)' }}>
                  {t(`checks.${c.check}`, { defaultValue: c.check })}
                </span>
                <span style={{ color: c.ok ? 'var(--bid-success)' : 'var(--bid-warn)' }}>
                  {c.ok ? '✓' : '!'}
                </span>
                <span className="text-[11px]" style={{ color: 'var(--bid-muted-2)' }}>
                  {c.ok ? t('checks.ok') : t('checks.issues_n', { n: c.issues.length })}
                </span>
              </div>
              {c.issues.map((i, idx) => (
                <div
                  key={idx}
                  className="mt-1 text-[11px]"
                  style={{
                    color: i.veto
                      ? 'var(--bid-primary)'
                      : i.severity === 'high'
                        ? 'var(--bid-warn)'
                        : 'var(--bid-muted)',
                  }}
                >
                  {i.veto ? '⛔' : i.severity === 'high' ? '●' : '·'} {i.desc}
                </div>
              ))}
            </div>
          ))}
        </div>

        {veto && (
          <div
            className="mb-3 text-xs"
            style={{ color: 'var(--bid-primary)' }}
            data-testid="bid-audit-veto-warning"
          >
            {t('phase6.veto_warning')}
          </div>
        )}

        {issues.length > 0 && (
          <>
            <div className="mb-2.5 text-[13px] font-extrabold" style={{ color: 'var(--bid-ink)' }}>
              {t('phase6.issues_detail')}（{s.total_issues}）
            </div>
            <div className="flex flex-col gap-2">
              {issues.map((i, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 rounded-[10px] px-3.5 py-2.5"
                  style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
                >
                  <span
                    className="flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold"
                    style={{
                      background:
                        i.level === 'veto' ? 'var(--bid-primary-soft)' : 'var(--bid-warn-soft)',
                      color: i.level === 'veto' ? 'var(--bid-primary)' : 'var(--bid-warn)',
                    }}
                  >
                    {t(i.level === 'veto' ? 'checks.veto' : `checks.${i.level}`)}
                  </span>
                  <span className="flex-1 text-xs" style={{ color: 'var(--bid-ink-2)' }}>
                    {i.text}
                  </span>
                  <span
                    onClick={onLocate}
                    data-testid="bid-audit-locate"
                    className="flex-shrink-0 cursor-pointer whitespace-nowrap text-[11px] font-bold"
                    style={{ color: 'var(--bid-primary)' }}
                  >
                    {t('phase6.locate')}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Right: layout / cover / export */}
      <div
        className="flex w-[300px] flex-shrink-0 flex-col gap-4 overflow-auto p-4"
        style={{ borderLeft: '1px solid var(--bid-border)' }}
      >
        <div>
          <SectionLabel>{t('export.layout_title')}</SectionLabel>
          <div
            className="mb-2.5 flex gap-1.5 rounded-[9px] p-0.5"
            style={{ background: 'var(--bid-paper)' }}
          >
            {(['upload', 'text'] as const).map(tab => (
              <div
                key={tab}
                onClick={() => setLayoutTab(tab)}
                className="flex-1 cursor-pointer rounded-md py-1.5 text-center text-[11px]"
                style={{
                  background: layoutTab === tab ? '#fff' : 'transparent',
                  color: layoutTab === tab ? 'var(--bid-ink)' : 'var(--bid-muted-2)',
                  fontWeight: layoutTab === tab ? 700 : 400,
                }}
              >
                {t(tab === 'upload' ? 'export.tab_upload' : 'export.tab_text')}
              </div>
            ))}
          </div>
          {layoutTab === 'upload' ? (
            <div
              onClick={() => layoutFileRef.current?.click()}
              className="cursor-pointer rounded-[10px] p-4 text-center"
              style={{ border: '1.5px dashed var(--bid-border-2)', background: '#fff' }}
            >
              <div className="mb-1 text-xl">📄</div>
              <div className="text-xs" style={{ color: 'var(--bid-sub)' }}>
                {t('export.upload_hint')}
              </div>
              <div className="mt-0.5 text-[10.5px]" style={{ color: 'var(--bid-muted-3)' }}>
                {t('export.upload_types')}
              </div>
              <input ref={layoutFileRef} type="file" multiple className="hidden" />
            </div>
          ) : (
            <textarea
              value={layoutText}
              onChange={e => setLayoutText(e.target.value)}
              placeholder={t('export.text_placeholder')}
              className="min-h-[120px] w-full resize-y rounded-lg p-2.5 text-xs outline-none"
              style={{
                border: '1px solid var(--bid-border-2)',
                background: '#fff',
                fontFamily: 'inherit',
              }}
            />
          )}
        </div>

        <div>
          <SectionLabel>{t('export.cover')}</SectionLabel>
          <div className="flex gap-2.5">
            {COVERS.map(cv => (
              <button
                key={cv.id}
                type="button"
                onClick={() => setCover(cv.id)}
                className="flex flex-1 flex-col items-center gap-1.5 rounded-xl p-2"
                style={{
                  border:
                    cover === cv.id
                      ? '2px solid var(--bid-primary)'
                      : '1px solid var(--bid-border-2)',
                }}
              >
                <span className="h-12 w-full rounded-md" style={{ background: cv.band }} />
                <span className="text-[9px]" style={{ color: 'var(--bid-muted)' }}>
                  {t(`export.cover_${cv.id}`)}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <SectionLabel>{t('export.export_title')}</SectionLabel>
          {finalized ? (
            <div
              className="rounded-xl p-4"
              style={{
                background: 'var(--bid-success-soft)',
                border: '1px solid var(--bid-success)',
              }}
              data-testid="bid-export-done"
            >
              <div className="mb-1.5 text-[22px]">✅</div>
              <div className="mb-1 text-[12.5px] font-bold" style={{ color: 'var(--bid-success)' }}>
                {t('export.done_title')}
              </div>
              <div className="mb-2.5 break-all text-[11.5px]" style={{ color: 'var(--bid-sub)' }}>
                {t('export.exported_name')}
              </div>
              <span
                onClick={download}
                className="cursor-pointer text-[11.5px] font-bold"
                style={{ color: 'var(--bid-primary)' }}
              >
                {t('export.re_export')}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <ExportBtn onClick={download} disabled={downloading} testid="bid-download-button">
                {downloading ? t('phase6.downloading') : t('export.export_word')}
              </ExportBtn>
              <ExportBtn disabled>
                {t('export.export_pdf')} · {t('export.soon')}
              </ExportBtn>
              <ExportBtn disabled>
                {t('export.export_zip')} · {t('export.soon')}
              </ExportBtn>
              <button
                type="button"
                onClick={onFinalize}
                disabled={finalizing}
                data-testid="bid-audit-finalize-button"
                className="mt-1 rounded-[9px] py-3 text-[13px] font-bold text-white disabled:opacity-60"
                style={{ background: 'var(--bid-primary)' }}
              >
                {finalizing ? t('phase6.finalizing') : t('export.one_click')}
              </button>
              {downloadError && (
                <div
                  className="text-xs"
                  style={{ color: 'var(--bid-primary)' }}
                  data-testid="bid-download-error"
                >
                  {downloadError}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
    >
      {children}
    </div>
  )
}

function Donut({ pct, label, unit }: { pct: number; label: string; unit: string }) {
  return (
    <div
      className="mx-auto flex items-center justify-center rounded-full"
      style={{
        width: 84,
        height: 84,
        background: `conic-gradient(var(--bid-primary) ${pct * 3.6}deg, #EEE6E4 0deg)`,
      }}
    >
      <div
        className="flex items-center justify-center rounded-full text-lg font-extrabold"
        style={{ width: 64, height: 64, background: '#fff', color: 'var(--bid-ink)' }}
      >
        {label}
        <span className="text-[11px] font-normal">{unit}</span>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2.5 text-xs font-extrabold" style={{ color: 'var(--bid-sub)' }}>
      {children}
    </div>
  )
}

function SmallBtn({
  onClick,
  children,
  testid,
  disabled,
  accent,
}: {
  onClick: () => void
  children: ReactNode
  testid: string
  disabled?: boolean
  accent?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className="rounded-lg px-2.5 py-1.5 text-[11px] disabled:opacity-60"
      style={
        accent
          ? { border: '1px solid var(--bid-primary)', color: 'var(--bid-primary)' }
          : { background: '#fff', border: '1px solid var(--bid-border-2)', color: 'var(--bid-sub)' }
      }
    >
      {children}
    </button>
  )
}

function ExportBtn({
  onClick,
  children,
  testid,
  disabled,
}: {
  onClick?: () => void
  children: ReactNode
  testid?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className="flex items-center gap-2.5 rounded-[9px] px-3 py-2.5 text-left text-xs disabled:opacity-60"
      style={{
        background: '#fff',
        border: '1px solid var(--bid-border)',
        color: 'var(--bid-ink-2)',
      }}
    >
      {children}
    </button>
  )
}
