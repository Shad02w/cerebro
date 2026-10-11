import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { PreviewableImage } from '@/components/image-preview-dialog'

const src = 'data:image/png;base64,iVBORw0KGgo='

describe('PreviewableImage', () => {
  it('opens the shared viewer with zoom controls and closes on Escape', async () => {
    const user = userEvent.setup()
    render(<PreviewableImage src={src} alt="diagram" />)
    expect(screen.queryByTestId('image-preview')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Open image: diagram' }))
    expect(await screen.findByTestId('image-preview')).toBeInTheDocument()
    for (const name of ['Zoom in', 'Zoom out', 'Reset zoom', 'Close preview'])
      expect(screen.getByRole('button', { name })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('image-preview')).toBeNull()
  })
})
