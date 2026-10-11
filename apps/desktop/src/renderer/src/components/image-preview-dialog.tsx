import { useEffect, useRef, useState } from 'react'
import Panzoom, { type PanzoomObject } from '@panzoom/panzoom'
import { MinusIcon, PlusIcon, RotateCcwIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'

const maxScale = 8
const minScale = 0.25

/**
 * Full-window image viewer shared by chat attachments, agent markdown, and the changes view.
 * Wheel, pinch, drag, double-click, and the toolbar zoom the `children` image.
 */
export function ImagePreviewDialog({
  title,
  onClose,
  children
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  const panzoom = useRef<PanzoomObject | null>(null)

  useEffect(() => {
    const target = stage?.firstElementChild
    if (!stage || !(target instanceof HTMLElement)) return
    const instance = Panzoom(target, { maxScale, minScale, cursor: 'inherit' })
    const onWheel = (event: WheelEvent): void => {
      instance.zoomWithWheel(event)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    panzoom.current = instance
    return () => {
      stage.removeEventListener('wheel', onWheel)
      instance.destroy()
      panzoom.current = null
    }
  }, [stage])

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        data-testid="image-preview"
        className="top-0 left-0 h-full max-h-none w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-background/80 p-0 shadow-none sm:max-w-none"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div
          ref={setStage}
          data-testid="image-preview-stage"
          className="flex h-full w-full cursor-grab items-center justify-center overflow-hidden p-8 active:cursor-grabbing"
          onDoubleClick={() => {
            const instance = panzoom.current
            if (!instance) return
            if (instance.getScale() > 1) instance.reset()
            else instance.zoomIn({ step: 1 })
          }}
        >
          <div className="flex max-h-full max-w-full items-center justify-center [&_img]:pointer-events-none [&_img]:max-h-full [&_img]:max-w-full [&_img]:rounded-lg [&_img]:object-contain [&_img]:shadow-lg [&_img]:select-none">
            {children}
          </div>
        </div>
        <div className="absolute top-4 right-4 flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Zoom out"
            onClick={() => panzoom.current?.zoomOut()}
          >
            <MinusIcon />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Zoom in"
            onClick={() => panzoom.current?.zoomIn()}
          >
            <PlusIcon />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Reset zoom"
            onClick={() => panzoom.current?.reset()}
          >
            <RotateCcwIcon />
          </Button>
          <DialogClose
            render={
              <Button type="button" variant="outline" size="icon-sm" aria-label="Close preview" />
            }
          >
            <XIcon />
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** A thumbnail image that opens the shared preview on click. */
export function PreviewableImage({
  src,
  alt,
  className,
  onError
}: {
  src: string
  alt?: string
  className?: string
  onError?: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label={`Open image: ${alt || 'image'}`}
        className="inline-block max-w-full cursor-zoom-in rounded-lg"
        onClick={() => setOpen(true)}
      >
        <img src={src} alt={alt} className={className} onError={onError} />
      </button>
      {open ? (
        <ImagePreviewDialog title={alt || 'Image preview'} onClose={() => setOpen(false)}>
          <img src={src} alt={alt} />
        </ImagePreviewDialog>
      ) : null}
    </>
  )
}
