import { memo } from 'react'
import { Streamdown, type AllowedTags, type ControlsConfig } from 'streamdown'
import { markdownComponents } from './markdown-components'
import { markdownPlugins } from './markdown-plugins'
import { prepareVideoMarkdown } from './video-markdown'

const controls: ControlsConfig = {
  table: false,
  image: false,
  code: false,
  mermaid: { copy: true, download: false, fullscreen: true, panZoom: true }
}

// Streamdown's sanitizer follows GitHub and would drop `<video>` (and any `file:` source) entirely.
const allowedTags: AllowedTags = {
  video: [
    'src',
    'poster',
    'controls',
    'width',
    'height',
    'loop',
    'muted',
    'autoPlay',
    'playsInline',
    'title'
  ]
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
        allowedTags={allowedTags}
        lineNumbers={false}
        linkSafety={{ enabled: false }}
        urlTransform={keepUrl}
      >
        {prepareVideoMarkdown(text)}
      </Streamdown>
    </div>
  )
})
