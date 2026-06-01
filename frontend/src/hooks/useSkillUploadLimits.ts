// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'

import {
  DEFAULT_MAX_SKILL_SIZE_MB,
  fetchSkillUploadLimits,
} from '@/apis/skills'

let cachedMaxFileSizeMb: number | null = null
let inflight: Promise<number> | null = null

function loadMaxSkillSizeMb(): Promise<number> {
  if (cachedMaxFileSizeMb !== null) {
    return Promise.resolve(cachedMaxFileSizeMb)
  }
  if (!inflight) {
    inflight = fetchSkillUploadLimits()
      .then((limits) => {
        cachedMaxFileSizeMb = limits.max_file_size_mb
        return cachedMaxFileSizeMb
      })
      .catch(() => DEFAULT_MAX_SKILL_SIZE_MB)
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/** Server-configured Skill ZIP upload limit (from ``MAX_SKILL_SIZE`` env, unit MB). */
export function useSkillUploadLimits() {
  const [maxFileSizeMb, setMaxFileSizeMb] = useState(
    cachedMaxFileSizeMb ?? DEFAULT_MAX_SKILL_SIZE_MB
  )
  const [isLoading, setIsLoading] = useState(cachedMaxFileSizeMb === null)

  useEffect(() => {
    let cancelled = false
    setIsLoading(cachedMaxFileSizeMb === null)
    void loadMaxSkillSizeMb().then((mb) => {
      if (!cancelled) {
        setMaxFileSizeMb(mb)
        setIsLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  return {
    maxFileSizeMb,
    maxFileSizeBytes: maxFileSizeMb * 1024 * 1024,
    isLoading,
  }
}
