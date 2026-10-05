import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  type ComponentProps,
  type CSSProperties
} from 'react'
import {
  LazyMotion,
  domAnimation,
  m,
  useMotionValue,
  useSpring,
  type HTMLMotionProps,
  type SpringOptions,
  type Transition
} from 'motion/react'
import { cn } from '@/lib/utils'

/** Theme teal lifted toward white, so the dots stay light teal in dark and light UI. */
const LIGHT_TEAL = 'color-mix(in srgb, var(--sidebar-selected) 48%, white)'

type StarLayerProps = HTMLMotionProps<'div'> & {
  count: number
  size: number
  transition: Transition
  starColor: string
}

function generateStars(count: number, starColor: string): string {
  const shadows: string[] = []
  for (let i = 0; i < count; i++) {
    const x = Math.floor(Math.random() * 4000) - 2000
    const y = Math.floor(Math.random() * 4000) - 2000
    shadows.push(`${x}px ${y}px ${starColor}`)
  }
  return shadows.join(', ')
}

function StarLayer({
  count = 1000,
  size = 1,
  transition = { repeat: Infinity, duration: 50, ease: 'linear' },
  starColor = LIGHT_TEAL,
  className,
  ...props
}: StarLayerProps): React.JSX.Element {
  const boxShadow = useMemo(() => generateStars(count, starColor), [count, starColor])

  return (
    <m.div
      data-slot="star-layer"
      animate={{ y: [0, -2000] }}
      transition={transition}
      className={cn('absolute top-0 left-0 h-[2000px] w-full', className)}
      {...props}
    >
      <div
        className="absolute rounded-full bg-transparent"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          boxShadow
        }}
      />
      <div
        className="absolute top-[2000px] rounded-full bg-transparent"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          boxShadow
        }}
      />
    </m.div>
  )
}

export type StarsBackgroundProps = ComponentProps<'div'> & {
  factor?: number
  speed?: number
  transition?: SpringOptions
  starColor?: string
  pointerEvents?: boolean
}

/**
 * Animate UI stars background (MIT).
 * https://animate-ui.com/docs/components/backgrounds/stars
 * A light theme-teal field, without a bright glow behind the composer.
 */
export function StarsBackground({
  children,
  className,
  factor = 0.05,
  speed = 50,
  transition = { stiffness: 50, damping: 20 },
  starColor = LIGHT_TEAL,
  pointerEvents = true,
  style,
  ...props
}: StarsBackgroundProps): React.JSX.Element {
  const nodeRef = useRef<HTMLDivElement>(null)
  const offsetX = useMotionValue(1)
  const offsetY = useMotionValue(1)
  const springX = useSpring(offsetX, transition)
  const springY = useSpring(offsetY, transition)

  const handleMouseMove = useEffectEvent((event: { clientX: number; clientY: number }) => {
    const centerX = window.innerWidth / 2
    const centerY = window.innerHeight / 2
    offsetX.set(-(event.clientX - centerX) * factor)
    offsetY.set(-(event.clientY - centerY) * factor)
  })

  useEffect(() => {
    const node = nodeRef.current
    const target = pointerEvents ? node : node?.parentElement
    if (!target) return
    const onMove = (event: MouseEvent): void => {
      handleMouseMove(event)
    }
    target.addEventListener('mousemove', onMove)
    return () => target.removeEventListener('mousemove', onMove)
  }, [pointerEvents])

  const light = {
    ...style,
    '--chat-star': starColor,
    backgroundColor: 'transparent',
    backgroundImage:
      'radial-gradient(ellipse at bottom, color-mix(in srgb, var(--sidebar-selected) 42%, transparent) 0%, transparent 78%)'
  } as CSSProperties

  return (
    <LazyMotion features={domAnimation}>
      <div
        {...props}
        ref={nodeRef}
        data-slot="stars-background"
        data-star-color={starColor}
        className={cn('relative size-full overflow-hidden', className)}
        style={light}
      >
        <m.div
          style={{ x: springX, y: springY }}
          className={cn({ 'pointer-events-none': !pointerEvents })}
        >
          <StarLayer
            count={1000}
            size={1}
            transition={{ repeat: Infinity, duration: speed, ease: 'linear' }}
            starColor={starColor}
          />
          <StarLayer
            count={400}
            size={2}
            transition={{ repeat: Infinity, duration: speed * 2, ease: 'linear' }}
            starColor={starColor}
          />
          <StarLayer
            count={200}
            size={3}
            transition={{ repeat: Infinity, duration: speed * 3, ease: 'linear' }}
            starColor={starColor}
          />
        </m.div>
        {children}
      </div>
    </LazyMotion>
  )
}
