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
        className="flex h-full items-center justify-center text-sm text-text-secondary"
        data-testid="bid-audit-running"
      >
        {t('phase6.running')}
      </div>
    )
  }

  const veto = report.verdict === 'NEED_FIX_VETO'
  const badge = report.verdict === 'PASS' ? 'bg-primary' : veto ? 'bg-error' : 'bg-amber-500'

  return (
    <div className="flex h-full flex-col gap-4 p-6" data-testid="bid-audit-screen">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded px-3 py-1 text-sm font-semibold text-white ${badge}`}
          data-testid="bid-audit-verdict"
        >
          {t(`phase6.verdict_${report.verdict}`)}
        </span>
        <span className="text-sm text-text-secondary">
          {t('phase6.coverage')}: {report.summary.scoring_coverage} · {t('phase6.veto_issues')}:{' '}
          {report.summary.veto_issues} · {t('phase6.high_issues')}: {report.summary.high_issues}
        </span>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-border">
        <ul className="flex flex-col divide-y divide-border">
          {report.checks.map(c => (
            <li key={c.check} className="p-3" data-testid={`bid-audit-check-${c.check}`}>
              <div className="flex justify-between text-sm">
                <span className="font-medium">{c.check}</span>
                <span className={c.ok ? 'text-text-muted' : 'text-error'}>
                  {c.ok ? 'ok' : String(c.issues.length)}
                </span>
              </div>
              {c.issues.map((i, idx) => (
                <div
                  key={idx}
                  className={`mt-1 text-xs ${
                    i.veto
                      ? 'text-error'
                      : i.severity === 'high'
                        ? 'text-amber-600'
                        : 'text-text-muted'
                  }`}
                >
                  {i.veto ? '⛔' : i.severity === 'high' ? '●' : '·'} {i.desc}
                </div>
              ))}
            </li>
          ))}
        </ul>
      </div>

      {veto && (
        <div className="text-xs text-error" data-testid="bid-audit-veto-warning">
          {t('phase6.veto_warning')}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setNonce(n => n + 1)}
          data-testid="bid-audit-rerun-button"
          className="rounded-lg border border-border px-4 py-2 text-sm"
        >
          {t('phase6.rerun')}
        </button>
        <button
          type="button"
          onClick={onRework}
          data-testid="bid-audit-rework-button"
          className="rounded-lg border border-primary px-4 py-2 text-sm text-primary"
        >
          {t('phase6.rework')}
        </button>
        <button
          type="button"
          onClick={onFinalize}
          data-testid="bid-audit-finalize-button"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
        >
          {t('phase6.finalize')}
        </button>
      </div>
    </div>
  )
}
