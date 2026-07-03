// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'

interface Props {
  label: string
  value: Record<string, unknown>
  onValidChange: (parsed: Record<string, unknown>) => void
}

export function JsonEditor({ label, value, onValidChange }: Props) {
  const { t } = useTranslation('bidWorkbench')
  const [text, setText] = useState(() => JSON.stringify(value, null, 2))
  const [error, setError] = useState<string | null>(null)

  const onChange = (next: string) => {
    setText(next)
    try {
      const parsed = JSON.parse(next)
      setError(null)
      onValidChange(parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'invalid json')
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-semibold">{label}</label>
      <textarea
        value={text}
        onChange={e => onChange(e.target.value)}
        data-testid={`json-editor-${label}`}
        className="min-h-[160px] w-full rounded-lg border border-border p-3 font-mono text-xs"
      />
      {error && (
        <div className="text-xs text-error" data-testid={`json-editor-error-${label}`}>
          {t('phase3.json_error')}: {error}
        </div>
      )}
    </div>
  )
}
