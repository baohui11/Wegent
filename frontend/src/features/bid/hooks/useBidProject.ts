// SPDX-License-Identifier: Apache-2.0

import { useCallback, useState } from 'react'
import { bidApis, type TenderDoc } from '@/apis/bid'

type Phase = 'idle' | 'creating' | 'parsing' | 'ready' | 'error'

export function useBidProject() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [tender, setTender] = useState<TenderDoc | null>(null)
  const [error, setError] = useState<string | null>(null)

  const startFromText = useCallback(async (text: string) => {
    setError(null)
    try {
      setPhase('creating')
      const project = await bidApis.createProject('标书项目')
      setPhase('parsing')
      await bidApis.parse(project.id, text)
      const { tender } = await bidApis.getTender(project.id)
      setTender(tender)
      setPhase('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown')
      setPhase('error')
    }
  }, [])

  const reset = useCallback(() => {
    setPhase('idle')
    setTender(null)
    setError(null)
  }, [])

  return { phase, tender, error, startFromText, reset }
}
