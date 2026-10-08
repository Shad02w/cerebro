import { memo } from 'react'
import { Streamdown, type ControlsConfig } from 'streamdown'
import { markdownComponents } from './markdown-components'
import { markdownPlugins } from './markdown-plugins'

const controls: ControlsConfig = {
  table: false,
  image: false,
  code: { copy: true, download: false },
  mermaid: { copy: true, download: false, fullscreen: true, panZoom: true }
}

const keepUrl = (url: string): string => url

/**
 * Renders markdown text from any agent harness. It only depends on the normalized chat text, so
 * Claude, Codex and Pi share it. `streaming` marks the item that is still receiving deltas.
 */
export const AgentMarkdown = memo(function AgentMarkdown({
  text,
  streaming = false
}: {
  text: string
  streaming?: boolean
}): React.JSX.Element {
  return (
    <div className="chat-markdown text-sm leading-7 break-words">
      <Streamdown
        mode="streaming"
        isAnimating={streaming}
        plugins={markdownPlugins}
        components={markdownComponents}
        controls={controls}
        linkSafety={{ enabled: false }}
        urlTransform={keepUrl}
      >
        {text}
      </Streamdown>
    </div>
  )
})
