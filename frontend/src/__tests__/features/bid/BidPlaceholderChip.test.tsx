// SPDX-License-Identifier: Apache-2.0
import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import { BidPlaceholderChip } from '@/features/bid/components/BidPlaceholderChip'

const chip = (raw: string) =>
  render(
    <BidPlaceholderChip
      {...({ node: { attrs: { raw } }, extension: { options: {} } } as unknown as ComponentProps<
        typeof BidPlaceholderChip
      >)}
    />
  )

test('renders a readable label while keeping the verbatim raw marker', () => {
  chip('{{qual:资质证书}}')
  const el = screen.getByTestId('bid-placeholder-chip')
  expect(el).toHaveTextContent('资质证书')
  expect(el).toHaveAttribute('data-raw', '{{qual:资质证书}}')
})

test('labels bracketed and source-hint markers', () => {
  chip('[待填项目名称]')
  expect(screen.getByTestId('bid-placeholder-chip')).toHaveTextContent('待填项目名称')
})
