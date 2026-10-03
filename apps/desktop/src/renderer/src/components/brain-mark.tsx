import neurologyMark from '@/assets/neurology.svg?raw'
import { cn } from '@/lib/utils'

/** Matches `.startup-mark` in startup.css (`38.4px * 1.6`). */
export const BRAIN_MARK_MD_SIZE = 38.4 * 1.6

function geometry(svg: string): { viewBox: string; d: string } {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1]
  const d = svg.match(/\sd="([^"]+)"/)?.[1]
  if (!viewBox || !d) throw new Error('Neurology SVG is missing geometry')
  return { viewBox, d }
}

const neurology = geometry(neurologyMark)

type BrainMarkProps = {
  pulse?: boolean
  size?: 'md' | 'sm'
  className?: string
  testId?: string
}

export function BrainMark({
  pulse = false,
  size = 'md',
  className,
  testId = 'brain-mark'
}: BrainMarkProps): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={neurology.viewBox}
      width={size === 'sm' ? 28 : BRAIN_MARK_MD_SIZE}
      height={size === 'sm' ? 28 : BRAIN_MARK_MD_SIZE}
      data-testid={testId}
      aria-label="Cerebro"
      role="img"
      className={cn('block shrink-0', pulse && 'animate-pulse', className)}
    >
      <path fill="currentColor" d={neurology.d} />
    </svg>
  )
}
