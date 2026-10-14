import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { AgentCapabilities, AgentCatalog, AgentHarness, AgentModel } from '@cerebro/core'
import { ModelPicker } from '@/components/chat/model-picker'

const capabilities: AgentCapabilities = {
  resume: true,
  cancel: true,
  approvals: 'tools',
  questions: true,
  modelSelection: 'between-turns',
  imageInput: true,
  steering: true,
  fork: 'native'
}

const model = (
  harness: AgentHarness,
  id: string,
  label: string,
  provider = 'configured'
): AgentModel => ({
  key: JSON.stringify([harness, 'local', provider, id]),
  instance: 'local',
  harness,
  provider,
  id,
  label,
  source: 'native',
  available: true,
  reasoning: []
})

const sonnet = model('claude', 'sonnet', 'Sonnet 5.5')
const accountDefault = model('claude', 'default', 'Default (recommended) · Sonnet 5.5')
const gpt = model('codex', 'gpt-5.5', 'GPT-5.5')
const pi = model('pi', 'pi-model', 'Pi Model')
const piAnthropic = model('pi', 'claude-sonnet', 'Claude Sonnet', 'anthropic')
const piRouter = model('pi', 'claude-sonnet', 'Claude Sonnet', 'openrouter')

function catalog(favorites: AgentModel[], models = [sonnet, gpt, pi]): AgentCatalog {
  return {
    capabilities: { claude: capabilities, codex: capabilities, pi: capabilities },
    models,
    favorites,
    issues: {}
  }
}

function Picker({
  sessionStarted = false,
  initial = sonnet
}: {
  sessionStarted?: boolean
  initial?: AgentModel
}): React.JSX.Element {
  const [selected, setSelected] = useState(initial)
  return <ModelPicker selected={selected} sessionStarted={sessionStarted} onSelect={setSelected} />
}

function renderPicker(
  favorites: AgentModel[],
  sessionStarted = false,
  models?: AgentModel[],
  initial?: AgentModel
): void {
  window.cerebro = {
    agentCatalog: async () => catalog(favorites, models),
    agentFavorite: async () => catalog(favorites, models)
  } as unknown as typeof window.cerebro
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Picker sessionStarted={sessionStarted} initial={initial} />
    </QueryClientProvider>
  )
}

describe('ModelPicker', () => {
  it('shows the harness icon in front of the model name', () => {
    renderPicker([])
    const trigger = screen.getByTestId('chat-model-picker')
    expect(trigger.querySelector('[data-harness-icon="claude"]')).toBeTruthy()
    expect(screen.getByTestId('chat-model-picker-label')).toHaveTextContent('Sonnet 5.5')
    expect(screen.getByTestId('chat-model-picker-label').textContent).not.toMatch(/Claude Code|·/)
    expect(trigger).toHaveAttribute('title', 'Sonnet 5.5 · Claude Code')
  })

  it('opens on favorites before a session when any exist, and search crosses harnesses', async () => {
    const user = userEvent.setup()
    renderPicker([gpt])
    await user.click(screen.getByTestId('chat-model-picker'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Favorites' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    )
    expect(screen.getByRole('option', { name: /GPT-5.5/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Sonnet 5.5/ })).not.toBeInTheDocument()

    await user.type(screen.getByRole('combobox', { name: 'Search models' }), 'sonnet')
    expect(await screen.findByRole('option', { name: /Sonnet 5.5/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /GPT-5.5/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Favorites' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(screen.getByRole('button', { name: 'Claude Code' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('opens on the selected harness after a session starts, and search still crosses harnesses', async () => {
    const user = userEvent.setup()
    renderPicker([gpt], true)
    await user.click(screen.getByTestId('chat-model-picker'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Claude Code' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    )
    expect(screen.getByRole('button', { name: 'Favorites' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(screen.getByRole('option', { name: /Sonnet 5.5/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /GPT-5.5/ })).not.toBeInTheDocument()

    await user.type(screen.getByRole('combobox', { name: 'Search models' }), 'gpt')
    expect(await screen.findByRole('option', { name: /GPT-5.5/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Sonnet 5.5/ })).not.toBeInTheDocument()
  })

  it('lists one Sonnet when the account default names that model', async () => {
    const user = userEvent.setup()
    renderPicker([], true, [accountDefault, sonnet, gpt], accountDefault)
    await waitFor(() =>
      expect(screen.getByTestId('chat-model-picker-label')).toHaveTextContent(/^Sonnet 5\.5$/)
    )
    await user.click(screen.getByTestId('chat-model-picker'))
    expect(await screen.findByRole('option', { name: 'Sonnet 5.5' })).toBeInTheDocument()
    expect(screen.getAllByRole('option', { name: /Sonnet 5\.5/ })).toHaveLength(1)
    expect(screen.queryByRole('option', { name: /Default/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Claude Code/ })).not.toBeInTheDocument()
  })

  it('names the Pi provider when the same model is listed twice', async () => {
    const user = userEvent.setup()
    renderPicker([], true, [piAnthropic, piRouter], piAnthropic)
    await waitFor(() =>
      expect(screen.getByTestId('chat-model-picker-label')).toHaveTextContent(
        'Claude Sonnet · anthropic'
      )
    )
    await user.click(screen.getByTestId('chat-model-picker'))
    expect(await screen.findByRole('option', { name: 'Claude Sonnet · anthropic' })).toBeVisible()
    expect(screen.getByRole('option', { name: 'Claude Sonnet · openrouter' })).toBeVisible()
  })
})
