// SPDX-License-Identifier: Apache-2.0

'use client'

import dynamic from 'next/dynamic'
import { useIsMobile } from '@/features/layout/hooks/useMediaQuery'

const BidWorkbenchDesktop = dynamic(
  () => import('./BidWorkbenchDesktop').then(m => ({ default: m.BidWorkbenchDesktop })),
  { ssr: false }
)
const BidWorkbenchMobile = dynamic(
  () => import('./BidWorkbenchMobile').then(m => ({ default: m.BidWorkbenchMobile })),
  { ssr: false }
)

export default function BidWorkbenchPage() {
  const isMobile = useIsMobile()
  return isMobile ? <BidWorkbenchMobile /> : <BidWorkbenchDesktop />
}
