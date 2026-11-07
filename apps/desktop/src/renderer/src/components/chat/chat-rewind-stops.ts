/** What a rewind would stop right now. Empty when the session is idle and a rewind stops nothing. */
export function rewindStops(session: {
  status?: string
  queue?: unknown[]
  background?: Array<{ status: string }>
  subagents?: Array<{ status: string }>
}): string[] {
  const lines: string[] = []
  if (session.status === 'running') lines.push('The agent is working. It will be stopped.')
  if (session.status === 'waiting')
    lines.push('The agent is waiting for an answer. The request will be declined.')
  if (session.queue?.length)
    lines.push(
      session.queue.length === 1
        ? '1 queued message will be removed.'
        : `${session.queue.length} queued messages will be removed.`
    )
  if (session.background?.some((task) => task.status === 'running'))
    lines.push('Background tasks will be stopped.')
  if (session.subagents?.some((child) => child.status === 'created' || child.status === 'running'))
    lines.push('Running child agents will be stopped.')
  return lines
}
