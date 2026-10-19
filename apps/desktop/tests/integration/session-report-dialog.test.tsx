import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '@cerebro/core'
import type { SessionReportExportResult, SessionReportRequest } from '@shared/types'
import { SessionReportDialog } from '@/components/chat/session-report-dialog'

const session: AgentSession = {
  version: 1,
  id: 'sess-1',
  workspaceId: 4,
  repositoryId: null,
  cwd: '/tmp/app',
  title: 'Login',
  model: {
    key: 'claude:anthropic:sonnet',
    instance: 'local',
    harness: 'claude',
    provider: 'anthropic',
    id: 'claude-sonnet',
    label: 'Sonnet',
    source: 'native',
    available: true,
    reasoning: []
  },
  status: 'failed',
  generation: 'g1',
  sequence: 2,
  updatedAt: 1,
  items: [
    {
      id: 'user-1',
      turnId: 'turn-1',
      kind: 'user',
      text: 'Look at this',
      attachments: [
        { id: 'shot', kind: 'image', name: 'board.png', mimeType: 'image/png', bytes: 1200 }
      ]
    }
  ],
  commands: []
}

function stub(impl: (request: SessionReportRequest) => Promise<SessionReportExportResult>): {
  exportSessionReport: ReturnType<typeof vi.fn>
  chatAttachment: ReturnType<typeof vi.fn>
} {
  const exportSessionReport = vi.fn(impl)
  const chatAttachment = vi.fn(async () => ({ mimeType: 'image/png' as const, data: 'aGk=' }))
  Object.defineProperty(window, 'cerebro', {
    configurable: true,
    value: { exportSessionReport, chatAttachment }
  })
  return { exportSessionReport, chatAttachment }
}

afterEach(() => {
  Reflect.deleteProperty(window, 'cerebro')
})

describe('SessionReportDialog', () => {
  it('describes the session and does not send until a rating is chosen', async () => {
    const { exportSessionReport } = stub(async () => ({ state: 'canceled' }))
    const user = userEvent.setup()
    render(<SessionReportDialog session={session} />)
    await user.click(screen.getByTestId('session-report-open'))
    expect(screen.getByTestId('session-report-dialog')).toHaveTextContent('Sonnet')
    expect(screen.getByTestId('session-report-dialog')).toHaveTextContent('failed')
    expect(screen.getByText(/not uploaded/)).toBeInTheDocument()
    await user.click(screen.getByTestId('session-report-send'))
    expect(await screen.findByRole('alert')).toHaveTextContent('problem or helpful')
    expect(exportSessionReport).not.toHaveBeenCalled()
  })

  it('sends the session, the rating, and images already in the conversation', async () => {
    const { exportSessionReport, chatAttachment } = stub(async () => ({
      state: 'saved',
      path: '/tmp/cerebro-session-report.zip',
      bytes: 100,
      images: 1
    }))
    const user = userEvent.setup()
    render(<SessionReportDialog session={session} />)
    await user.click(screen.getByTestId('session-report-open'))
    await user.click(screen.getByTestId('session-report-score-problem'))
    await user.type(screen.getByLabelText('What happened'), 'It stopped')
    await user.click(screen.getByTestId('session-report-transcript'))
    await user.click(screen.getByTestId('session-report-session-images'))
    await user.click(screen.getByTestId('session-report-send'))
    expect(await screen.findByTestId('session-report-result')).toHaveTextContent('1 image')
    expect(chatAttachment).toHaveBeenCalledWith(4, 'sess-1', 'shot')
    expect(exportSessionReport).toHaveBeenCalledWith(
      expect.objectContaining({
        score: 'problem',
        comment: 'It stopped',
        includeTranscript: true,
        session,
        images: [
          expect.objectContaining({
            id: 'shot',
            source: 'session',
            mimeType: 'image/png',
            data: 'aGk='
          })
        ]
      })
    )
  })

  it('refuses a file that is not an image', async () => {
    stub(async () => ({ state: 'canceled' }))
    const user = userEvent.setup()
    render(<SessionReportDialog session={session} />)
    await user.click(screen.getByTestId('session-report-open'))
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const input = screen.getByTestId('session-report-image-input')
    fireEvent.change(input, { target: { files: [file] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('PNG, JPEG, GIF, or WebP')
    expect(screen.queryByTestId('session-report-images')).toBeNull()
  })

  it('ignores a second send while a report is in flight', async () => {
    let finish: (value: SessionReportExportResult) => void = () => {}
    const { exportSessionReport } = stub(
      () => new Promise<SessionReportExportResult>((resolve) => (finish = resolve))
    )
    const user = userEvent.setup()
    render(<SessionReportDialog session={session} />)
    await user.click(screen.getByTestId('session-report-open'))
    await user.click(screen.getByTestId('session-report-score-helpful'))
    const send = screen.getByTestId('session-report-send')
    await user.click(send)
    expect(send).toHaveTextContent('Sending…')
    await user.click(send)
    expect(exportSessionReport).toHaveBeenCalledTimes(1)
    finish({ state: 'canceled' })
  })
})
