import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiagnosticsExportResult } from '@shared/types'
import { DiagnosticsSettings } from '@/components/diagnostics-settings'
import { SETTINGS_SECTIONS } from '@/lib/settings-sections'
import { isSettingsSectionId } from '@/lib/app-route'

function stubExport(
  impl: () => Promise<DiagnosticsExportResult>
): ReturnType<typeof vi.fn<() => Promise<DiagnosticsExportResult>>> {
  const exportDiagnostics = vi.fn(impl)
  Object.defineProperty(window, 'cerebro', {
    configurable: true,
    value: { exportDiagnostics }
  })
  return exportDiagnostics
}

afterEach(() => {
  Reflect.deleteProperty(window, 'cerebro')
})

describe('DiagnosticsSettings', () => {
  it('states what is and is not collected before anything is exported', () => {
    stubExport(async () => ({ state: 'canceled' }))
    render(<DiagnosticsSettings />)
    expect(screen.getByText(/Never included/)).toBeInTheDocument()
    expect(screen.getByText(/Terminal output or input, chat sessions/)).toBeInTheDocument()
    expect(screen.queryByTestId('diagnostics-result')).toBeNull()
  })

  it('shows where the bundle was saved and whether the mux was running', async () => {
    const exportDiagnostics = stubExport(async () => ({
      state: 'saved',
      path: '/Users/me/Downloads/cerebro-diagnostics-20261016-130509.zip',
      bytes: 3 * 1024 * 1024,
      muxRunning: false
    }))
    const user = userEvent.setup()
    render(<DiagnosticsSettings />)
    await user.click(screen.getByRole('button', { name: 'Export diagnostics…' }))
    expect(await screen.findByTestId('diagnostics-result')).toHaveTextContent(
      'Saved 3.0 MB (terminal server was not running).'
    )
    expect(screen.getByText(/cerebro-diagnostics-20261016-130509\.zip/)).toBeInTheDocument()
    expect(exportDiagnostics).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when the save dialog is canceled', async () => {
    stubExport(async () => ({ state: 'canceled' }))
    const user = userEvent.setup()
    render(<DiagnosticsSettings />)
    await user.click(screen.getByRole('button', { name: 'Export diagnostics…' }))
    expect(screen.queryByTestId('diagnostics-result')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Export diagnostics…' })).toBeInTheDocument()
  })

  it('reports a failure and keeps the button available to retry', async () => {
    const exportDiagnostics = stubExport(async () => {
      throw new Error('ENOSPC: no space left on device')
    })
    const user = userEvent.setup()
    render(<DiagnosticsSettings />)
    await user.click(screen.getByRole('button', { name: 'Export diagnostics…' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ENOSPC')
    await user.click(screen.getByRole('button', { name: 'Export diagnostics…' }))
    expect(exportDiagnostics).toHaveBeenCalledTimes(2)
  })

  it('ignores a second click while an export is in flight instead of disabling the button', async () => {
    let finish: (value: DiagnosticsExportResult) => void = () => {}
    const exportDiagnostics = stubExport(
      () => new Promise<DiagnosticsExportResult>((resolve) => (finish = resolve))
    )
    const user = userEvent.setup()
    render(<DiagnosticsSettings />)
    const button = screen.getByRole('button', { name: 'Export diagnostics…' })
    await user.click(button)
    const busy = await screen.findByRole('button', { name: 'Exporting…' })
    expect(busy).toBeEnabled()
    await user.click(busy)
    expect(exportDiagnostics).toHaveBeenCalledTimes(1)
    finish({ state: 'canceled' })
    expect(await screen.findByRole('button', { name: 'Export diagnostics…' })).toBeInTheDocument()
  })
})

describe('diagnostics settings section', () => {
  it('is routable and listed in the sidebar', () => {
    expect(isSettingsSectionId('diagnostics')).toBe(true)
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toContain('diagnostics')
  })
})
