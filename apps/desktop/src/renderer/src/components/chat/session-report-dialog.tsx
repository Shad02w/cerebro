import { useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import type { AgentSession, ChatAttachment } from '@cerebro/core'
import type { SessionReportImagePayload, SessionReportScore } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { dataUrl, formatBytes, prepareImage } from './chat-attachments'
import { chatImageAccept } from './use-composer-draft'

const scores: Array<{ id: SessionReportScore; label: string }> = [
  { id: 'problem', label: 'Problem' },
  { id: 'helpful', label: 'Helpful' }
]

function formatError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/Error invoking remote method '[^']+':\s*/gi, '').replace(/^Error:\s*/i, '')
}

function sessionImages(session: AgentSession): ChatAttachment[] {
  return session.items.flatMap((item) => item.attachments ?? [])
}

/** Report the open conversation, and attach images to send with it. */
export function SessionReportDialog({ session }: { session: AgentSession }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [score, setScore] = useState<SessionReportScore | null>(null)
  const [comment, setComment] = useState('')
  const [images, setImages] = useState<SessionReportImagePayload[]>([])
  const [includeTranscript, setIncludeTranscript] = useState(false)
  const [includeSessionImages, setIncludeSessionImages] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const storedImages = sessionImages(session)

  const reset = (): void => {
    setScore(null)
    setComment('')
    setImages([])
    setIncludeTranscript(false)
    setIncludeSessionImages(false)
    setError(null)
    setSaved(null)
    setBusy(false)
  }

  const handleOpenChange = (next: boolean): void => {
    if (busy) return
    if (!next) reset()
    setOpen(next)
  }

  const addImages = async (list: FileList | null): Promise<void> => {
    if (!list?.length) return
    setError(null)
    setSaved(null)
    const next = [...images]
    for (const file of list) {
      try {
        const prepared = await prepareImage(file)
        next.push({
          id: prepared.id,
          name: prepared.name,
          mimeType: prepared.mimeType,
          data: prepared.data,
          source: 'attached'
        })
      } catch (err) {
        setError(formatError(err))
        break
      }
    }
    setImages(next)
  }

  const send = async (): Promise<void> => {
    if (inFlight.current) return
    if (!score) {
      setError('Choose whether this conversation was a problem or helpful.')
      return
    }
    inFlight.current = true
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      const fromSession = includeSessionImages
        ? await Promise.all(
            storedImages.map(async (image) => {
              const content = await window.cerebro.chatAttachment(
                session.workspaceId,
                session.id,
                image.id
              )
              return {
                id: image.id,
                name: image.name,
                mimeType: content.mimeType,
                data: content.data,
                source: 'session' as const
              }
            })
          )
        : []
      const result = await window.cerebro.exportSessionReport({
        session,
        score,
        comment,
        includeTranscript,
        images: [...fromSession, ...images]
      })
      if (result.state === 'saved') {
        const count = result.images === 1 ? '1 image' : `${result.images} images`
        setSaved(`Saved ${count} with this conversation at ${result.path}`)
      }
    } catch (err) {
      setError(formatError(err))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="text-muted-foreground"
        data-testid="session-report-open"
        onClick={() => setOpen(true)}
      >
        Report
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent data-testid="session-report-dialog">
          <DialogHeader>
            <DialogTitle>Report this conversation</DialogTitle>
            <DialogDescription>
              Sends this session only: {session.model.label}, {session.status}. Add images of what
              you saw. The zip is saved for you to share and is not uploaded.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            aria-busy={busy}
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            <div className="space-y-2">
              <Label>How did this conversation go?</Label>
              <div className="flex gap-2">
                {scores.map((entry) => (
                  <Button
                    key={entry.id}
                    type="button"
                    size="sm"
                    variant={score === entry.id ? 'secondary' : 'outline'}
                    aria-pressed={score === entry.id}
                    data-testid={`session-report-score-${entry.id}`}
                    onClick={() => {
                      setScore(entry.id)
                      setError(null)
                    }}
                  >
                    {entry.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="session-report-comment">What happened</Label>
              <textarea
                id="session-report-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                placeholder="What were you trying to do?"
                className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Images</Label>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  data-testid="session-report-add-image"
                  onClick={() => fileInput.current?.click()}
                >
                  <ImagePlus aria-hidden="true" />
                  Add image
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept={chatImageAccept}
                  multiple
                  className="hidden"
                  data-testid="session-report-image-input"
                  onChange={(event) => {
                    void addImages(event.target.files)
                    event.target.value = ''
                  }}
                />
              </div>
              {images.length ? (
                <ul className="flex flex-wrap gap-2" data-testid="session-report-images">
                  {images.map((image) => (
                    <li key={image.id} className="relative">
                      <img
                        src={dataUrl(image)}
                        alt={image.name}
                        className="size-16 rounded-md border border-border object-cover"
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${image.name}`}
                        className="absolute -top-1 -right-1 rounded-full border border-border bg-background p-0.5"
                        onClick={() =>
                          setImages((current) => current.filter((entry) => entry.id !== image.id))
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  PNG, JPEG, GIF, or WebP. Up to 8 images, 5 MB each.
                </p>
              )}
            </div>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={includeTranscript}
                data-testid="session-report-transcript"
                onChange={(event) => setIncludeTranscript(event.target.checked)}
              />
              <span>Include this conversation&apos;s messages. Paths and tokens are removed.</span>
            </label>
            {storedImages.length ? (
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={includeSessionImages}
                  data-testid="session-report-session-images"
                  onChange={(event) => setIncludeSessionImages(event.target.checked)}
                />
                <span>
                  Include{' '}
                  {storedImages.length === 1 ? 'the image' : `${storedImages.length} images`}{' '}
                  already in this conversation (
                  {formatBytes(storedImages.reduce((sum, image) => sum + image.bytes, 0))}
                  ).
                </span>
              </label>
            ) : null}
            {saved ? (
              <p className="text-xs break-all" data-testid="session-report-result">
                {saved}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" size="sm" data-testid="session-report-send">
                {busy ? 'Sending…' : 'Send report…'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
