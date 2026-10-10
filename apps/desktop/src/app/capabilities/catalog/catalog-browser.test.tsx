import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { PageSearchShell } from '../../page-search-shell'

import { CatalogBrowser } from './catalog-browser'
import { type CatalogKind, parseCatalog } from './catalog-data'
import { $catalogCardView } from './store'

beforeEach(() => {
  $catalogCardView.set(true)
})

afterEach(() => {
  cleanup()
  $catalogCardView.set(true)
})

function setup(kind: CatalogKind) {
  const entries = parseCatalog(
    kind,
    ['alpha', 'beta'].map(name => ({
      name,
      identifier: `official/${name}`,
      installIdentifier: `official/${name}`,
      source: 'official',
      tier: 'official',
      category: name === 'alpha' ? 'memory' : 'voice',
      description: `${name} workflow`,
      repo: `https://github.com/example/${name}`,
      sourceUrl: `https://github.com/example/${name}`,
      docsUrl: `https://example.com/${name}`
    }))
  )

  const onInstall = vi.fn()

  function Harness() {
    const [query, setQuery] = useState('')

    return (
      <PageSearchShell onSearchChange={setQuery} searchPlaceholder="Search catalog" searchValue={query}>
        <CatalogBrowser
          installedEntries={entries}
          isInstalled={() => true}
          kind={kind}
          onInstall={onInstall}
          onQueryChange={setQuery}
          query={query}
        />
      </PageSearchShell>
    )
  }

  return { entries, onInstall, ...render(<Harness />) }
}

it('shares the saved layout choice when moving between Skills and Plugins', () => {
  setup('skills')
  fireEvent.click(screen.getByRole('button', { name: 'List view' }))
  expect($catalogCardView.get()).toBe(false)
  cleanup()

  const { container } = setup('plugins')
  expect(container.querySelector('[data-catalog-list="plugins"]')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Card view' }))
  expect($catalogCardView.get()).toBe(true)
})
