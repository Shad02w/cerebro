import type { ComponentProps } from 'react'
import { Code } from 'lucide-react'
import { defaultComponents } from 'streamdown'
import { codeLanguage } from './code-languages'

const DefaultCode = defaultComponents.code
const fenceLanguage = /language-([^\s]+)/

/** Fenced code gets a header with the language icon and name. Inline code and Mermaid are untouched. */
type CodeProps = ComponentProps<typeof DefaultCode>

export function MarkdownCode(props: CodeProps): React.JSX.Element {
  const tag = fenceLanguage.exec(props.className ?? '')?.[1]
  if (!('data-block' in props) || tag === 'mermaid') return <DefaultCode {...props} />
  const { label, icon } = codeLanguage(tag)
  return (
    <div className="chat-code relative my-3 rounded-lg bg-muted/60">
      <div className="flex h-8 items-center gap-1.5 px-3 text-xs text-muted-foreground">
        {icon ? (
          <img src={icon} alt="" className="size-3.5" />
        ) : (
          <Code className="size-3.5" aria-hidden />
        )}
        <span data-testid="code-language">{label}</span>
      </div>
      <DefaultCode {...props} />
    </div>
  )
}
