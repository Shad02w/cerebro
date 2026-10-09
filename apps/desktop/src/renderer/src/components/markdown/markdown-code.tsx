import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { Check, Code, Copy } from 'lucide-react'
import { defaultComponents } from 'streamdown'
import { useClipboard } from '@/hooks/use-clipboard'
import { cn } from '@/lib/utils'
import { codeLanguage } from './code-languages'

const DefaultCode = defaultComponents.code
const fenceLanguage = /language-([^\s]+)/

// Code and Mermaid blocks share one borderless, slightly darker surface with a soft shadow.
const surface =
  'my-5 rounded-lg border-0 bg-[oklch(0.085_0_0)] shadow-[inset_0_1px_0_oklch(1_0_0/0.07),0_1px_2px_oklch(0_0_0/0.6),0_10px_22px_-8px_oklch(0_0_0/0.9)]'

// Flattens Streamdown's own card chrome (border, grey background, padding, header) inside a code block.
const flatCode = cn(
  '**:data-[streamdown=code-block]:m-0 **:data-[streamdown=code-block]:gap-0 **:data-[streamdown=code-block]:border-0 **:data-[streamdown=code-block]:bg-transparent **:data-[streamdown=code-block]:p-0',
  '**:data-[streamdown=code-block-header]:hidden',
  '**:data-[streamdown=code-block-body]:rounded-lg **:data-[streamdown=code-block-body]:border-0 **:data-[streamdown=code-block-body]:bg-transparent **:data-[streamdown=code-block-body]:px-3 **:data-[streamdown=code-block-body]:pt-0 **:data-[streamdown=code-block-body]:pb-3 **:data-[streamdown=code-block-body]:text-xs **:data-[streamdown=code-block-body]:leading-5',
  '[&_pre]:bg-transparent!'
)

// Same for the Mermaid block: no inner border or grey fill, and a borderless action bar.
const flatMermaid = cn(
  'border-0',
  '[&>div:last-child]:border-0 [&>div:last-child]:bg-transparent',
  '**:data-[streamdown=mermaid-block-actions]:border-0 **:data-[streamdown=mermaid-block-actions]:bg-transparent **:data-[streamdown=mermaid-block-actions]:backdrop-blur-none'
)

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

/** Fenced code gets a header with the language icon and name on the left and a copy button on the right. Inline code and Mermaid are untouched. */
export function MarkdownCode(props: CodeProps): React.JSX.Element {
  const tag = fenceLanguage.exec(props.className ?? '')?.[1]
  if (tag === 'mermaid')
    return <DefaultCode {...props} className={cn(props.className, surface, flatMermaid)} />
  if (!('data-block' in props)) return <DefaultCode {...props} />
  const { label, icon } = codeLanguage(tag)
  return (
    <div className={cn('chat-code group', surface, flatCode)}>
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
