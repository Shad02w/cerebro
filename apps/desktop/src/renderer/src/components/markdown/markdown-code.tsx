import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { Check, Code, Copy } from 'lucide-react'
import { defaultComponents } from 'streamdown'
import { useClipboard } from '@/hooks/use-clipboard'
import { codeLanguage } from './code-languages'

const DefaultCode = defaultComponents.code
const fenceLanguage = /language-([^\s]+)/

type CodeProps = ComponentProps<typeof DefaultCode>

const textOf = (node: ReactNode): string =>
  typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : ''

function CopyCodeButton({ code }: { code: string }): React.JSX.Element {
  const copy = useClipboard()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <button
      type="button"
      title="Copy code"
      aria-label={copied ? 'Copied' : 'Copy code'}
      onClick={async () => setCopied(await copy(code.replace(/\n$/, '')))}
      className="ml-auto flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
}

/** Fenced code gets a header with the language icon and name, plus a copy button on hover. Inline code and Mermaid are untouched. */
export function MarkdownCode(props: CodeProps): React.JSX.Element {
  const tag = fenceLanguage.exec(props.className ?? '')?.[1]
  if (!('data-block' in props) || tag === 'mermaid') return <DefaultCode {...props} />
  const { label, icon } = codeLanguage(tag)
  return (
    <div className="chat-code group my-3 rounded-lg bg-muted/60">
      <div className="flex h-8 items-center gap-1.5 pr-1.5 pl-3 text-xs text-muted-foreground">
        {icon ? (
          <img src={icon} alt="" className="size-3.5" />
        ) : (
          <Code className="size-3.5" aria-hidden />
        )}
        <span data-testid="code-language">{label}</span>
        <CopyCodeButton code={textOf(props.children)} />
      </div>
      <DefaultCode {...props} />
    </div>
  )
}
