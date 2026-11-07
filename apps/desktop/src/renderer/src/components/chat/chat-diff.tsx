import { useMemo } from 'react'
import { parsePatchFiles } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { useAppearance } from '@/lib/appearance'
import { DIFF_SURFACE_CSS, DIFF_THEMES } from '@/lib/changes-highlighter'

/** Native patches retain a readable fallback while incomplete or nonstandard. */
export function ChatDiff({ patch }: { patch: string }): React.JSX.Element {
  const { resolved: themeType } = useAppearance()
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
            theme: DIFF_THEMES,
            themeType,
            unsafeCSS: DIFF_SURFACE_CSS,
            diffStyle: 'unified',
            overflow: 'scroll'
          }}
        />
      ))}
    </div>
  )
}
