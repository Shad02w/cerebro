import { useState } from 'react'
import type { FileDiffContents, FileImageContents } from '@shared/types'

function ImageVersion({
  image,
  path,
  label
}: {
  image: FileImageContents
  path: string
  label: string
}): React.JSX.Element {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  return (
    <figure className="min-w-0 flex-[1_1_240px] overflow-hidden rounded-md border border-border">
      <figcaption className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{(image.byteLength / 1024).toFixed(1)} KB</span>
      </figcaption>
      <div
        className="flex min-h-48 items-center justify-center p-4"
        style={{
          backgroundImage:
            'conic-gradient(var(--muted) 25%, transparent 0 50%, var(--muted) 0 75%, transparent 0)',
          backgroundSize: '16px 16px'
        }}
      >
        {!image.dataUrl || failedSrc === image.dataUrl ? (
          <p
            role="status"
            className="rounded bg-background px-3 py-2 text-xs text-muted-foreground"
          >
            {image.byteLength > 5 * 1024 * 1024
              ? 'Image exceeds the 5 MB preview limit.'
              : 'This image could not be displayed.'}
          </p>
        ) : (
          <img
            src={image.dataUrl}
            alt={`${label}: ${path}`}
            className="max-h-[65vh] max-w-full object-contain"
            loading="lazy"
            onError={() => setFailedSrc(image.dataUrl)}
          />
        )}
      </div>
    </figure>
  )
}

export function ChangesImagePreview({ diff }: { diff: FileDiffContents }): React.JSX.Element {
  return (
    <div data-testid="changes-file-preview" aria-label={`Preview ${diff.path}`}>
      {diff.kind === 'image' && (diff.oldImage || diff.newImage) ? (
        <div className="flex flex-wrap items-start gap-4 p-4">
          {diff.oldImage && (
            <ImageVersion
              image={diff.oldImage}
              path={diff.oldPath ?? diff.path}
              label="Before (HEAD)"
            />
          )}
          {diff.newImage && (
            <ImageVersion image={diff.newImage} path={diff.path} label="After (working tree)" />
          )}
        </div>
      ) : (
        <p className="m-auto p-6 text-sm text-muted-foreground">
          {diff.kind === 'image'
            ? 'Image is no longer available.'
            : diff.kind === 'binary'
              ? 'No preview is available for this binary file.'
              : 'File contents are no longer available.'}
        </p>
      )}
    </div>
  )
}
