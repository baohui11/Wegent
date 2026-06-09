// SPDX-FileCopyrightText: 2026 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

'use client'

import React, { useMemo, useState, useEffect } from 'react'
import { Video, ImageIcon } from 'lucide-react'
import { ModelIcon } from '@/components/icons/ModelIcon'
import { cn } from '@/lib/utils'
import type { GroupableModel } from './model-grouping'

/** Map modelGroup / provider labels to logo filenames in /public/model-providers/ */
const LOGO_ALIASES: Record<string, string> = {
  anthropic: 'anthropic',
  claude: 'anthropic',
  openai: 'openai',
  gpt: 'openai',
  google: 'google',
  gemini: 'google',
  vertexai: 'google',
  deepseek: 'deepseek',
  qwen: 'qwen',
  alibaba: 'qwen',
  tongyi: 'qwen',
  alicloud: 'qwen',
  kimi: 'kimi',
  moonshot: 'kimi',
  glm: 'glm',
  chatglm: 'glm',
  zhipu: 'glm',
  minimax: 'minimax',
  meta: 'meta',
  llama: 'meta',
  mistral: 'mistral',
  mistralai: 'mistral',
  xai: 'xai',
  grok: 'xai',
  doubao: 'doubao',
  bytedance: 'doubao',
  ernie: 'ernie',
  baidu: 'ernie',
  wenxin: 'ernie',
  hunyuan: 'hunyuan',
  tencent: 'hunyuan',
  sparkdesk: 'sparkdesk',
  iflytek: 'sparkdesk',
  yi: 'yi',
  baichuan: 'baichuan',
  stepfun: 'stepfun',
  internlm: 'internlm',
  siliconflow: 'siliconflow',
  ollama: 'ollama',
  openrouter: 'openrouter',
  groq: 'groq',
}

export function slugifyModelGroupName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function resolveModelProviderLogoSlug(
  groupName: string | null | undefined,
  provider?: string | null
): string | null {
  const candidates = [groupName, provider].filter(Boolean) as string[]

  for (const candidate of candidates) {
    const slug = slugifyModelGroupName(candidate)
    if (!slug) continue

    const alias = LOGO_ALIASES[slug]
    if (alias) return alias

    return slug
  }

  return null
}

export function resolveModelForProviderLogo(
  model: GroupableModel | null | undefined,
  options?: {
    defaultModelKey?: string
    fallbackModel?: GroupableModel | null
  }
): GroupableModel | null {
  const defaultModelKey = options?.defaultModelKey ?? '__default__'
  if (!model) {
    return options?.fallbackModel ?? null
  }
  if (model.name === defaultModelKey) {
    return options?.fallbackModel ?? null
  }
  return model
}

interface ModelProviderIconProps {
  groupName?: string | null
  provider?: string | null
  className?: string
  imageClassName?: string
}

export function ModelProviderIcon({
  groupName,
  provider,
  className,
  imageClassName,
}: ModelProviderIconProps) {
  const slug = useMemo(
    () => resolveModelProviderLogoSlug(groupName, provider),
    [groupName, provider]
  )
  const [failed, setFailed] = useState(false)
  const [extensionIndex, setExtensionIndex] = useState(0)

  useEffect(() => {
    setFailed(false)
    setExtensionIndex(0)
  }, [slug])

  const extensions = ['svg', 'png', 'webp'] as const
  const src = slug && !failed ? `/model-providers/${slug}.${extensions[extensionIndex]}` : null

  if (!src) {
    return <ModelIcon className={cn('h-4 w-4 shrink-0', className)} />
  }

  return (
    <img
      src={src}
      alt=""
      aria-hidden
      className={cn('h-4 w-4 shrink-0 object-contain', imageClassName, className)}
      onError={() => {
        if (extensionIndex < extensions.length - 1) {
          setExtensionIndex(current => current + 1)
          return
        }
        setFailed(true)
      }}
    />
  )
}

type SelectedModelIconCategory = 'llm' | 'video' | 'image'

interface SelectedModelProviderIconProps {
  model?: GroupableModel | null
  fallbackModel?: GroupableModel | null
  defaultModelKey?: string
  categoryType?: SelectedModelIconCategory
  className?: string
}

export function SelectedModelProviderIcon({
  model,
  fallbackModel,
  defaultModelKey = '__default__',
  categoryType = 'llm',
  className,
}: SelectedModelProviderIconProps) {
  const logoModel = useMemo(
    () => resolveModelForProviderLogo(model, { defaultModelKey, fallbackModel }),
    [defaultModelKey, fallbackModel, model]
  )

  if (categoryType === 'video') {
    return <Video className={cn('h-4 w-4 shrink-0', className)} />
  }

  if (categoryType === 'image') {
    return <ImageIcon className={cn('h-4 w-4 shrink-0', className)} />
  }

  return (
    <ModelProviderIcon
      groupName={logoModel?.modelGroup}
      provider={logoModel?.provider}
      className={className}
    />
  )
}
