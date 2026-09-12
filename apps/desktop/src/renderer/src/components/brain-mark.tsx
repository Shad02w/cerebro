import brainMark from '@/assets/brain.svg'
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
    <img
      src={brainMark}
      alt="Brain"
      data-testid={testId}
      width={size === 'sm' ? 28 : 140}
      height={size === 'sm' ? 24 : 122}
      className={cn('inline-block shrink-0 object-contain', pulse && 'animate-pulse', className)}
    />
  )
}
