import { useLayoutEffect } from 'react'
import { syncTurnClock } from './turn-durations'

/**
 * Remember how long each busy turn ran.
 * The start is kept outside this component, so a remount while the reply is still
 * streaming does not drop the time, and settling does not depend on a one-second ticker.
 */
export function TurnClock({
  active,
  activeIds,
  knownIds
}: {
  active: boolean
  activeIds: readonly string[]
  knownIds: readonly string[]
}): null {
  const activeKey = activeIds.join('\0')
  const knownKey = knownIds.join('\0')
  useLayoutEffect(() => {
    syncTurnClock(
      active,
      activeKey ? activeKey.split('\0') : [],
      knownKey ? knownKey.split('\0') : []
    )
  }, [active, activeKey, knownKey])
  return null
}
