// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import { bidApis, type AuditReport } from '@/apis/bid'

export function AuditScreen({
  projectId,
  onRework,
  onFinalize,
}: {
  projectId: number
  onRework: () => void
  onFinalize: () => void
}) {
  const { t } = useTranslation('bidWorkbench')
  const [report, setReport] = useState<AuditReport | null>(null)
  const [running, setRunning] = useState(true)
  const [nonce, setNonce] = useState(0)
  const [verifying, setVerifying] = useState(false)

  const verify = async () => {
    setVerifying(true)
    try {
      setReport(await bidApis.verifyAudit(projectId))
    } finally {
      setVerifying(false)
    }
  }

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

  return (
    <div
      className="flex h-full gap-6 overflow-auto p-6"
      style={{ background: 'var(--bid-paper)' }}
      data-testid="bid-audit-screen"
    >
      {/* Left: summary + risk */}
      <div className="flex w-[240px] flex-shrink-0 flex-col gap-4">
        <div
          className="flex flex-col items-center gap-2 rounded-2xl p-5"
          style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
        >
          <div className="text-xs" style={{ color: 'var(--bid-muted)' }}>
            {t('checks.summary')}
          </div>
          <div
            className="rounded-lg px-4 py-1 text-lg font-extrabold text-white"
            style={{ background: verdictColor }}
            data-testid="bid-audit-verdict"
          >
            {t(`phase6.verdict_${report.verdict}`)}
          </div>
          <div className="text-xs" style={{ color: 'var(--bid-sub)' }}>
            {t('phase6.coverage')}: {s.scoring_coverage}
          </div>
        </div>

        <div
          className="flex flex-col gap-2 rounded-2xl p-5"
          style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
        >
          <div className="text-sm font-bold" style={{ color: 'var(--bid-ink)' }}>
            {t('checks.risk_title')}
          </div>
          <div className="text-2xl font-extrabold" style={{ color: 'var(--bid-primary)' }}>
            {s.total_issues}
          </div>
          <div className="flex flex-col gap-1 text-xs" style={{ color: 'var(--bid-sub)' }}>
            <div>
              <span style={{ color: 'var(--bid-primary)' }}>●</span> {t('checks.veto')}:{' '}
              {s.veto_issues}
            </div>
            <div>
              <span style={{ color: 'var(--bid-warn)' }}>●</span> {t('checks.high')}:{' '}
              {s.high_issues}
            </div>
          </div>
        </div>
      </div>

      {/* Center: compliance table */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="text-sm font-bold" style={{ color: 'var(--bid-ink)' }}>
          {t('checks.title')}
        </div>
        <div
          className="overflow-hidden rounded-2xl"
          style={{ background: '#fff', border: '1px solid var(--bid-border)' }}
        >
          <div
            className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-2 text-xs"
            style={{ color: 'var(--bid-muted)', borderBottom: '1px solid var(--bid-border)' }}
          >
            <span>{t('checks.col_check')}</span>
            <span>{t('checks.col_status')}</span>
            <span>{t('checks.col_result')}</span>
          </div>
          {report.checks.map(c => (
            <div
              key={c.check}
              className="px-4 py-3"
              style={{ borderBottom: '1px solid var(--bid-border)' }}
              data-testid={`bid-audit-check-${c.check}`}
            >
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4">
                <span className="text-sm font-medium" style={{ color: 'var(--bid-ink-2)' }}>
                  {t(`checks.${c.check}`, { defaultValue: c.check })}
                </span>
                <span style={{ color: c.ok ? 'var(--bid-success)' : 'var(--bid-warn)' }}>
                  {c.ok ? '✓' : '!'}
                </span>
                <span className="text-xs" style={{ color: 'var(--bid-muted)' }}>
                  {c.ok ? t('checks.ok') : t('checks.issues_n', { n: c.issues.length })}
                </span>
              </div>
              {c.issues.map((i, idx) => (
                <div
                  key={idx}
                  className="mt-1 text-xs"
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
            className="text-xs"
            style={{ color: 'var(--bid-primary)' }}
            data-testid="bid-audit-veto-warning"
          >
            {t('phase6.veto_warning')}
          </div>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex w-[220px] flex-shrink-0 flex-col gap-2">
        <button
          type="button"
          onClick={verify}
          disabled={verifying}
          data-testid="bid-audit-verify-button"
          className="rounded-xl px-4 py-2.5 text-sm disabled:opacity-60"
          style={{
            background: '#fff',
            border: '1px solid var(--bid-border-2)',
            color: 'var(--bid-sub)',
          }}
        >
          {verifying ? t('phase6.verifying') : t('phase6.verify')}
        </button>
        <button
          type="button"
          onClick={() => setNonce(n => n + 1)}
          data-testid="bid-audit-rerun-button"
          className="rounded-xl px-4 py-2.5 text-sm"
          style={{
            background: '#fff',
            border: '1px solid var(--bid-border-2)',
            color: 'var(--bid-sub)',
          }}
        >
          {t('phase6.rerun')}
        </button>
        <button
          type="button"
          onClick={onRework}
          data-testid="bid-audit-rework-button"
          className="rounded-xl px-4 py-2.5 text-sm font-semibold"
          style={{ border: '1px solid var(--bid-primary)', color: 'var(--bid-primary)' }}
        >
          {t('phase6.rework')}
        </button>
        <button
          type="button"
          onClick={onFinalize}
          data-testid="bid-audit-finalize-button"
          className="rounded-xl px-4 py-2.5 text-sm font-bold text-white"
          style={{ background: 'var(--bid-primary)' }}
        >
          {t('phase6.finalize')}
        </button>
      </div>
    </div>
  )
}
