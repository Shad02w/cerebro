import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { TerminalThemeId } from '@shared/terminal-themes'
import { TerminalThemeCombobox } from './terminal-theme-combobox'

function Harness({ onChange }: { onChange: (id: TerminalThemeId) => void }): React.JSX.Element {
  const [value, setValue] = useState<TerminalThemeId>('cerebro-default')
  return (
    <TerminalThemeCombobox
      value={value}
      onChange={(id) => {
        setValue(id)
        onChange(id)
      }}
    />
  )
}

async function openPicker(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  await user.click(screen.getByTestId('settings-terminal-theme'))
  return user
}

describe('TerminalThemeCombobox', () => {
  it('lists every theme and marks the current one', async () => {
    render(<Harness onChange={() => {}} />)
    expect(screen.getByTestId('settings-terminal-theme')).toHaveTextContent('Cerebro Default')
    await openPicker()
    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toContain('Catppuccin Latte')
    expect(screen.getByRole('option', { name: 'Cerebro Default' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('shows an empty state when the search matches nothing', async () => {
    render(<Harness onChange={() => {}} />)
    const user = await openPicker()
    await user.type(await screen.findByTestId('settings-terminal-theme-search'), 'no such theme')
    expect(screen.getByText('No themes found.')).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('filters, moves the highlight with ArrowDown, and selects with Enter', async () => {
    const changes: TerminalThemeId[] = []
    render(<Harness onChange={(id) => changes.push(id)} />)
    const user = await openPicker()
    await user.type(await screen.findByTestId('settings-terminal-theme-search'), 'catppuccin')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Catppuccin Mocha',
      'Catppuccin Latte'
    ])
    await user.keyboard('{ArrowDown}{Enter}')
    expect(changes).toEqual(['catppuccin-latte'])
    expect(screen.getByTestId('settings-terminal-theme')).toHaveTextContent('Catppuccin Latte')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
