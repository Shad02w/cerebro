import { useLayoutEffect, useRef } from 'react'
import { recordTurnSeconds } from './turn-durations'
import { useWorkingSeconds } from './working-seconds'

/** Remember how long a turn ran, once it leaves the running state. */
export function TurnClock({ active, turnId }: { active: boolean; turnId?: string }): null {
  const seconds = useWorkingSeconds(active)
  const previous = useRef({ active, turnId, seconds })
  useLayoutEffect(() => {
    const prior = previous.current
    if (prior.active && !active && prior.turnId) recordTurnSeconds(prior.turnId, prior.seconds)
    previous.current = { active, turnId, seconds }
  }, [active, seconds, turnId])
  return null
}
