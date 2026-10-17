import { act, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ComposerFileMenu, type FileMenuHandle } from '@/components/chat/composer-file-menu'

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

  it('scrolls the highlighted file into the menu as ArrowDown moves past the fold', () => {
    const ref = createRef<FileMenuHandle>()
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: `file-${index}.ts`,
      label: `src/file-${index}.ts`
    }))
    render(<ComposerFileMenu ref={ref} items={items} loading={false} command={() => {}} />)
    const menu = screen.getByRole('listbox', { name: 'Files' })
    const options = screen.getAllByRole('option')
    const menuTop = 100
    const menuHeight = 80
    const rowHeight = 40
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({
      top: menuTop,
      bottom: menuTop + menuHeight,
      left: 0,
      right: 200,
      width: 200,
      height: menuHeight,
      x: 0,
      y: menuTop,
      toJSON: () => ({})
    })
    options.forEach((option, index) => {
      vi.spyOn(option, 'getBoundingClientRect').mockImplementation(() => {
        const top = menuTop + index * rowHeight - menu.scrollTop
        return {
          top,
          bottom: top + rowHeight,
          left: 0,
          right: 200,
          width: 200,
          height: rowHeight,
          x: 0,
          y: top,
          toJSON: () => ({})
        }
      })
    })

    act(() => {
      for (let step = 0; step < 4; step += 1) {
        ref.current?.onKeyDown({ event: new KeyboardEvent('keydown', { key: 'ArrowDown' }) })
      }
    })

    expect(options[4]).toHaveAttribute('aria-selected', 'true')
    expect(options[0]).toHaveAttribute('aria-selected', 'false')
    expect(menu.scrollTop).toBeGreaterThan(0)
    const visible = options[4].getBoundingClientRect()
    expect(visible.top).toBeGreaterThanOrEqual(menuTop - 1)
    expect(visible.bottom).toBeLessThanOrEqual(menuTop + menuHeight + 1)

    act(() => {
      for (let step = 0; step < 4; step += 1) {
        ref.current?.onKeyDown({ event: new KeyboardEvent('keydown', { key: 'ArrowDown' }) })
      }
    })

    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(menu.scrollTop).toBe(0)
  })
})
