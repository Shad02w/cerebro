import type { AgentActivityStatus } from '@cerebro/core'
import { agentStatusPresentation } from './agent-activity'

export function workingForLabel(since: number | undefined, now: number): string {
  if (since == null || !Number.isFinite(since)) return 'Working'
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  if (seconds < 60) return `Working for ${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `Working for ${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `Working for ${hours}h ${minutes % 60}m`
}

export function agentStatusLabel(
  agent: {
    status: AgentActivityStatus
    requestKind?: 'approval' | 'question'
    runningSince?: number
  },
  now: number
): { text: string; color: string; aria: string } | null {
  if (agent.status === 'idle') return null
  const presentation = agentStatusPresentation[agent.status]
  if (agent.status === 'running') {
    return {
      text: workingForLabel(agent.runningSince, now),
      color: presentation.color,
      aria: presentation.label
    }
  }
  if (agent.status === 'waiting') {
    return {
      text: agent.requestKind === 'question' ? 'Needs an answer' : 'Needs approval',
      color: presentation.color,
      aria: presentation.label
    }
  }
  const text = { finished: 'Done', failed: 'Failed', interrupted: 'Interrupted' } as const
  return { text: text[agent.status], color: presentation.color, aria: presentation.label }
}

/** Short age for a session's `updatedAt`. */
export function relativeUpdated(updatedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
