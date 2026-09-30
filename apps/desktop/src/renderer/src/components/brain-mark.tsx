import { BrainSparkleIcon } from '@/components/brain-sparkle-icon'
import { cn } from '@/lib/utils'

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
      size={size === 'sm' ? 28 : 128}
      testId={testId}
      label="Brain"
      className={cn(pulse && 'animate-pulse', className)}
    />
  )
}
