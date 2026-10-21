import { useState, type ComponentProps } from 'react'
import type { ExtraProps } from 'streamdown'
import { isLocalSource, isVideoSource, mediaUrl, readVideoMarkdownSource } from '@shared/media'

type VideoProps = ComponentProps<'video'> & ExtraProps & { alt?: string }

const player =
  'my-3 block h-auto max-h-[420px] w-auto max-w-full rounded-lg border border-border/70 bg-black shadow-[inset_0_1px_0_oklch(1_0_0/0.06),0_10px_22px_-12px_oklch(0_0_0/0.9)]'

function fileName(value: string): string {
  const path = value.trim().split(/[?#]/)[0]
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const name = path.slice(separator + 1) || path
  try {
    return decodeURI(name)
  } catch {
    return name
  }
}

function Placeholder({ label, source }: { label: string; source: string }): React.JSX.Element {
  return (
    <span data-testid="chat-video-placeholder" className="text-muted-foreground">
      [Video: {label}] <span className="font-mono text-xs break-all">{source}</span>
    </span>
  )
}

/**
 * Video from an agent reply. Local files stream through the main process (never the network);
 * remote URLs are shown as text because a model-written URL can carry data out of the app.
 */
export function MarkdownVideo({
  src,
  poster,
  alt,
  title,
  muted,
  loop,
  playsInline
}: VideoProps): React.JSX.Element | null {
  const [failed, setFailed] = useState(false)
  const source = typeof src === 'string' ? src : ''
  if (!source) return null

  const local = readVideoMarkdownSource(source) ?? source
  const playable = isLocalSource(local) && isVideoSource(local)
  const label = alt || title || fileName(local) || 'video'
  if (!playable || failed) return <Placeholder label={label} source={source} />

  const posterSource =
    typeof poster === 'string' ? (readVideoMarkdownSource(poster) ?? poster) : null
  return (
    <video
      data-testid="chat-video"
      controls
      preload="metadata"
      src={mediaUrl(local)}
      poster={posterSource && isLocalSource(posterSource) ? mediaUrl(posterSource) : undefined}
      muted={muted}
      loop={loop}
      playsInline={playsInline}
      aria-label={label}
      onError={() => setFailed(true)}
      className={player}
    />
  )
}
