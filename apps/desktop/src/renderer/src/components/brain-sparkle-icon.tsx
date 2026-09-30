import filledMark from '@/assets/brain-sparkle-16-filled.svg?raw'
import regularMark from '@/assets/brain-sparkle-16-regular.svg?raw'
import { cn } from '@/lib/utils'

const marks = {
  filled: filledMark,
  regular: regularMark
} as const

export type BrainSparkleVariant = keyof typeof marks

function geometry(svg: string): { viewBox: string; d: string } {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1]
  const d = svg.match(/\sd="([^"]+)"/)?.[1]
  if (!viewBox || !d) throw new Error('Brain sparkle SVG is missing geometry')
  return { viewBox, d }
}

const geometryByVariant = {
  filled: geometry(marks.filled),
  regular: geometry(marks.regular)
}

type BrainSparkleIconProps = {
  variant?: BrainSparkleVariant
  size?: number
  className?: string
  testId?: string
  label?: string
}

export function BrainSparkleIcon({
  variant = 'filled',
  size = 128,
  className,
  testId,
  label
}: BrainSparkleIconProps): React.JSX.Element {
  const { viewBox, d } = geometryByVariant[variant]
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      width={size}
      height={size}
      data-testid={testId}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      className={cn('block shrink-0', className)}
    >
      <path fill="currentColor" d={d} />
    </svg>
  )
}
