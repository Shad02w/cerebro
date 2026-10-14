import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ComposerFileMenu } from '@/components/chat/composer-file-menu'

describe('ComposerFileMenu', () => {
  it('shows a brand icon and the path relative to the working directory', () => {
    render(
      <ComposerFileMenu
        items={[{ id: 'src/app.ts', label: 'src/app.ts' }]}
        loading={false}
        command={() => {}}
      />
    )
    const option = screen.getByRole('option', { name: 'src/app.ts' })
    expect(option).toHaveAttribute('data-path', 'src/app.ts')
    expect(option.querySelector('img')).toBeTruthy()
    expect(option).toHaveAttribute('data-file-icon', 'brand')
  })

  it('keeps the previous rows on screen while a new search is in flight', () => {
    const { rerender } = render(
      <ComposerFileMenu
        items={[{ id: 'README.md', label: 'README.md' }]}
        loading={false}
        command={() => {}}
      />
    )
    rerender(<ComposerFileMenu items={[]} loading command={() => {}} />)
    expect(screen.getByRole('option', { name: 'README.md' })).toBeVisible()
    expect(screen.queryByText('Searching…')).toBeNull()
  })
})
