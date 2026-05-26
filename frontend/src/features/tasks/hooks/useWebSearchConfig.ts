// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import { getSearchEngines, type SearchEngine } from '@/apis/chat'

export function useWebSearchConfig() {
  const [enableWebSearch, setEnableWebSearch] = useState(false)
  const [selectedSearchEngine, setSelectedSearchEngine] = useState<string | null>(null)
  const [searchEngines, setSearchEngines] = useState<SearchEngine[]>([])
  const [isWebSearchAvailable, setIsWebSearchAvailable] = useState(false)

  useEffect(() => {
    let cancelled = false

    void getSearchEngines()
      .then(response => {
        if (cancelled) return
        const available = response.enabled && response.engines.length > 0
        setIsWebSearchAvailable(available)
        setSearchEngines(response.engines)
      })
      .catch(() => {
        if (!cancelled) {
          setIsWebSearchAvailable(false)
          setSearchEngines([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const handleSelectSearchEngine = useCallback((engine: string) => {
    setSelectedSearchEngine(engine)
  }, [])

  return {
    enableWebSearch,
    setEnableWebSearch,
    selectedSearchEngine,
    setSelectedSearchEngine: handleSelectSearchEngine,
    searchEngines,
    isWebSearchAvailable,
  }
}
