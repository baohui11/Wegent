// SPDX-FileCopyrightText: 2026 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  ModelCascadeContent,
  type ModelCascadeLabels,
} from '@/components/model-select/ModelCascadeSelect'
import type { GroupableModel } from '@/components/model-select/model-grouping'

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const labels: ModelCascadeLabels = {
  ungrouped: 'Ungrouped',
  uncategorized: 'Uncategorized',
  searchPlaceholder: 'Search models or groups...',
  searchResults: 'Search Results',
  noModels: 'No models available',
  noMatch: 'No matching models',
}

const models: GroupableModel[] = [
  {
    name: 'model-a',
    displayName: 'Model A',
    provider: 'provider-one',
    modelId: 'provider-one-model-a',
    modelGroup: 'Anthropic',
    modelSubGroup: 'Claude 3',
  },
  {
    name: 'model-b',
    displayName: 'Model B',
    provider: 'provider-two',
    modelId: 'provider-two-model-b',
    modelGroup: 'Anthropic',
    modelSubGroup: 'Claude 4',
  },
  {
    name: 'model-c',
    displayName: 'Model C',
    provider: 'provider-three',
    modelId: 'provider-three-model-c',
    modelGroup: 'OpenAI',
  },
]

describe('ModelCascadeContent', () => {
  it('shows expandable single-level groups with models inside', () => {
    render(
      <ModelCascadeContent
        models={models}
        labels={labels}
        searchValue=""
        onSearchValueChange={jest.fn()}
        onSelectModel={jest.fn()}
      />
    )

    expect(screen.getByText('Anthropic')).toBeInTheDocument()
    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getByText('Model A')).toBeInTheDocument()
    expect(screen.getByText('Model C')).toBeInTheDocument()
    expect(screen.queryByText('Primary Groups')).not.toBeInTheDocument()
  })

  it('collapses and expands groups', () => {
    render(
      <ModelCascadeContent
        models={models}
        labels={labels}
        searchValue=""
        onSearchValueChange={jest.fn()}
        onSelectModel={jest.fn()}
      />
    )

    const anthropicGroup = screen.getByTestId('model-tree-group-Anthropic')
    expect(screen.getByText('Model A')).toBeVisible()

    fireEvent.click(anthropicGroup)
    expect(screen.getByText('Model A')).not.toBeVisible()

    fireEvent.click(anthropicGroup)
    expect(screen.getByText('Model A')).toBeVisible()
  })

  it('switches to flat searchable results including group text', () => {
    const onSearchValueChange = jest.fn()

    const { rerender } = render(
      <ModelCascadeContent
        models={models}
        labels={labels}
        searchValue=""
        onSearchValueChange={onSearchValueChange}
        onSelectModel={jest.fn()}
      />
    )

    fireEvent.change(screen.getByTestId('model-cascade-search-input'), {
      target: { value: 'OpenAI' },
    })
    expect(onSearchValueChange).toHaveBeenCalledWith('OpenAI')

    rerender(
      <ModelCascadeContent
        models={models}
        labels={labels}
        searchValue="OpenAI"
        onSearchValueChange={onSearchValueChange}
        onSelectModel={jest.fn()}
      />
    )

    expect(screen.getByText('Search Results')).toBeInTheDocument()
    expect(screen.getByText('Model C')).toBeInTheDocument()
    expect(screen.queryByText('Model A')).not.toBeInTheDocument()
  })

  it('constrains the tree list so long model lists do not push the footer out', () => {
    render(
      <ModelCascadeContent
        models={models}
        labels={labels}
        searchValue=""
        onSearchValueChange={jest.fn()}
        onSelectModel={jest.fn()}
        footer={<div data-testid="model-cascade-footer-content">Footer</div>}
      />
    )

    const tree = screen.getByTestId('model-cascade-tree')
    const footer = screen.getByTestId('model-cascade-footer')

    expect(tree).toHaveClass('min-h-0')
    expect(tree.className).toContain('h-[clamp(')
    expect(footer).toHaveClass('shrink-0')
  })

  it('constrains search results so they do not push the footer out', () => {
    render(
      <ModelCascadeContent
        models={models}
        labels={labels}
        searchValue="Model"
        onSearchValueChange={jest.fn()}
        onSelectModel={jest.fn()}
        footer={<div data-testid="model-cascade-footer-content">Footer</div>}
      />
    )

    const results = screen.getByTestId('model-cascade-search-results')
    const footer = screen.getByTestId('model-cascade-footer')

    expect(results).toHaveClass('min-h-0')
    expect(results.className).toContain('h-[clamp(')
    expect(footer).toHaveClass('shrink-0')
  })
})
