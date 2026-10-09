import { useQuery } from '@tanstack/react-query'

const remoteSource = /^(?:https?:)?\/\//i
const dataImage = /^data:image\//i

function Placeholder({ alt, src }: { alt?: string; src: string }): React.JSX.Element {
  return (
    <span className="text-muted-foreground">
      [Image: {alt || 'image'}] <span className="font-mono text-xs break-all">{src}</span>
    </span>
  )
}

function LocalImage({ alt, src }: { alt?: string; src: string }): React.JSX.Element {
  const image = useQuery({
    queryKey: ['chat-image', src],
    queryFn: () => window.cerebro.chatImage(src),
    staleTime: Infinity,
    retry: false
  })
  if (image.data)
    return (
      <img
        src={`data:${image.data.mimeType};base64,${image.data.data}`}
        alt={alt}
        className="my-2 h-auto max-w-full rounded-lg border"
      />
    )
  if (image.error) return <Placeholder alt={alt} src={src} />
  return <span className="inline-block h-24 w-40 animate-pulse rounded-lg bg-muted align-middle" />
}

/**
 * Image in an agent reply. Local files load through the main process; remote URLs are never
 * fetched, since a model-written URL can carry data out of the app.
 */
export function MarkdownImage({
  src,
  alt
}: {
  src?: string | Blob
  alt?: string
}): React.JSX.Element | null {
  if (typeof src !== 'string' || !src) return null
  if (dataImage.test(src)) return <img src={src} alt={alt} className="my-2 h-auto max-w-full" />
  if (remoteSource.test(src)) return <Placeholder alt={alt} src={src} />
  return <LocalImage alt={alt} src={src} />
}
