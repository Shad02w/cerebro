import { cn } from '@/lib/utils'

/** Side profile (facing left): cerebrum `#`, cerebellum/brainstem `o`. */
const BRAIN = [
  '.....##########.....',
  '...##############...',
  '..#####.##########..',
  '..################..',
  '..########.#######..',
  '...######.########..',
  '.....#####ooooooo...',
  '..........oooooo....',
  '............ooo.....',
  '.............oo.....'
] as const

const COLS = BRAIN[0].length

const DOT = {
  md: { cell: '0.4rem', gap: '1px' },
  sm: { cell: '0.085rem', gap: '0px' }
} as const

type BrainMarkProps = {
  pulse?: boolean
  size?: keyof typeof DOT
  className?: string
  testId?: string
}

export function BrainMark({
  pulse = false,
  size = 'md',
  className,
  testId = 'brain-mark'
}: BrainMarkProps): React.JSX.Element {
  const { cell, gap } = DOT[size]

  return (
    <div
      data-testid={testId}
      role="img"
      aria-label="Brain"
      className={cn('inline-grid text-muted-foreground', pulse && 'animate-pulse', className)}
      style={{ gridTemplateColumns: `repeat(${COLS}, ${cell})`, gap }}
    >
      {BRAIN.flatMap((row, y) =>
        [...row].map((cellChar, x) => (
          <span
            key={`${y}-${x}`}
            className={cn(
              'rounded-full',
              cellChar === '#' && 'bg-current',
              cellChar === 'o' && 'bg-current opacity-50'
            )}
            style={{ width: cell, height: cell }}
          />
        ))
      )}
    </div>
  )
}
