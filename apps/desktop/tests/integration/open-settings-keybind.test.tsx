import { act, render } from '@testing-library/react'
import { parseHotkey } from '@tanstack/react-hotkeys'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { KeybindProvider, useKeybindHandler } from '@/keybinds'

function Probe(): React.JSX.Element {
  const [opened, setOpened] = useState(false)
  useKeybindHandler('openSettings', () => {
    setOpened(true)
    return true
  })
  return <div data-testid="opened">{opened ? 'yes' : 'no'}</div>
}

function press(init: KeyboardEventInit): void {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    )
  })
}

describe('open settings keybind', () => {
  beforeEach(() => {
    window.cerebro = {
      onMenuClose: () => () => {}
    } as unknown as typeof window.cerebro
  })

  it('matches Mod+, and ignores comma without the modifier', () => {
    const view = render(
      <KeybindProvider overrides={null}>
        <Probe />
      </KeybindProvider>
    )
    press({ key: ',', code: 'Comma' })
    expect(view.getByTestId('opened')).toHaveTextContent('no')

    const parsed = parseHotkey('Mod+,')
    press({
      key: ',',
      code: 'Comma',
      ctrlKey: parsed.ctrl,
      metaKey: parsed.meta,
      altKey: parsed.alt,
      shiftKey: parsed.shift
    })
    expect(view.getByTestId('opened')).toHaveTextContent('yes')
  })
})
