import { useMemo } from 'react'
import { parsePatchFiles } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'

/** Native patches retain a readable fallback while incomplete or nonstandard. */
export function ChatDiff({ patch }: { patch: string }): React.JSX.Element {
  const files = useMemo(() => {
    if (patch.length > 100_000) return []
    try {
      return parsePatchFiles(patch, undefined, true).flatMap((entry) => entry.files)
    } catch {
      return []
    }
  }, [patch])
  if (!files.length || patch.length > 100_000)
    return (
      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-5">
        {patch}
      </pre>
    )
  return (
    <div className="mt-2 max-h-96 overflow-auto" data-testid="chat-diff">
      {files.map((file) => (
        <FileDiff
          key={file.name}
          fileDiff={file}
          options={{
            theme: 'pierre-dark',
            themeType: 'dark',
            diffStyle: 'unified',
            overflow: 'scroll'
          }}
        />
      ))}
    </div>
  )
}
