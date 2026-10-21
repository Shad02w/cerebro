import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AgentMarkdown } from '@/components/markdown/agent-markdown'

const renderMarkdown = (text: string): HTMLElement => {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <AgentMarkdown text={text} />
    </QueryClientProvider>
  )
  return container
}

const sourceOf = (element: Element): string | null => element.getAttribute('src')

describe('video in agent markdown', () => {
  it('renders raw video tags, file sources, and source children as local players', () => {
    renderMarkdown(
      [
        '## Clips',
        '',
        '<video controls src="file:///tmp/clip%20one.mp4"></video>',
        '',
        '<video src="/tmp/plain.mp4" muted loop poster="file:///tmp/poster%20one.png"></video>',
        '',
        '<video controls><source src="file:///tmp/source.webm" type="video/webm"></video>'
      ].join('\n')
    )

    const players = screen.getAllByTestId('chat-video')
    expect(players).toHaveLength(3)
    expect(players.map(sourceOf)).toEqual([
      'cerebro-media://local/file%3A%2F%2F%2Ftmp%2Fclip%2520one.mp4',
      'cerebro-media://local/%2Ftmp%2Fplain.mp4',
      'cerebro-media://local/file%3A%2F%2F%2Ftmp%2Fsource.webm'
    ])
    for (const player of players) {
      expect(player).toHaveAttribute('controls')
      expect(player).toHaveAttribute('preload', 'metadata')
    }
    expect(players[0]).toHaveAttribute('aria-label', 'clip one.mp4')
    expect(players[1]).toHaveAttribute('loop')
    expect(players[1]).toHaveAttribute(
      'poster',
      'cerebro-media://local/file%3A%2F%2F%2Ftmp%2Fposter%2520one.png'
    )
  })

  it('renders video markdown images and keeps images, remote videos, and code untouched', () => {
    const container = renderMarkdown(
      [
        '![clip](/tmp/ext.mp4)',
        '',
        '![remote](https://example.invalid/remote.mp4)',
        '',
        '![shot](/tmp/shot.png)',
        '',
        '```html',
        '<video src="/tmp/in-code.mp4"></video>',
        '```'
      ].join('\n')
    )

    expect(screen.getAllByTestId('chat-video')).toHaveLength(1)
    expect(screen.getByTestId('chat-video')).toHaveAttribute(
      'src',
      'cerebro-media://local/%2Ftmp%2Fext.mp4'
    )
    expect(screen.getByTestId('chat-video')).toHaveAttribute('aria-label', 'clip')

    expect(screen.getByTestId('chat-video-placeholder')).toHaveTextContent(
      'https://example.invalid/remote.mp4'
    )
    // The local image still goes through the image pipeline instead of becoming a player.
    expect(container.querySelectorAll('video')).toHaveLength(1)
    expect(container.textContent).toContain('<video src="/tmp/in-code.mp4"></video>')
    expect(container.querySelector('code')?.textContent).toContain('/tmp/in-code.mp4')
  })

  it('shows a placeholder instead of a player when the video fails to load', async () => {
    const container = renderMarkdown('<video src="/tmp/missing.mp4"></video>')
    fireEvent.error(screen.getByTestId('chat-video'))
    expect(container.querySelector('video')).toBeNull()
    expect(await screen.findByTestId('chat-video-placeholder')).toHaveTextContent('missing.mp4')
  })
})
