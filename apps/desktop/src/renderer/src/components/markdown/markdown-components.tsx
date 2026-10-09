import type { Components } from 'streamdown'
import { MarkdownCode } from './markdown-code'
import { MarkdownImage } from './markdown-image'

/** Overrides shared by every agent's markdown. Everything else uses Streamdown's own renderers. */
export const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault()
        if (href && /^https?:\/\//.test(href)) void window.cerebro.openExternal(href)
      }}
      className="underline underline-offset-2"
    >
      {children}
    </a>
  ),
  code: MarkdownCode,
  img: ({ src, alt }) => <MarkdownImage src={src} alt={alt} />
}
