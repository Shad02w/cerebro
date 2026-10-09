import { createCodePlugin } from '@streamdown/code'
import { createMermaidPlugin } from '@streamdown/mermaid'
import type { PluginConfig } from 'streamdown'

/** The app is dark-only, so both slots use a dark Shiki theme. Languages and Mermaid load on demand. */
export const markdownPlugins: PluginConfig = {
  code: createCodePlugin({ themes: ['github-dark', 'github-dark'] }),
  mermaid: createMermaidPlugin({ config: { theme: 'dark' } })
}
