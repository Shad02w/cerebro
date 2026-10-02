import { BrainSparkleIcon } from '@/components/brain-sparkle-icon'
import { cn } from '@/lib/utils'

/** Matches `.startup-mark` in startup.css (`38.4px * 1.6`). */
export const BRAIN_MARK_MD_SIZE = 38.4 * 1.6

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
    <BrainSparkleIcon
      size={size === 'sm' ? 28 : BRAIN_MARK_MD_SIZE}
      testId={testId}
      label="Brain"
      className={cn(pulse && 'animate-pulse', className)}
    />
  )
}
