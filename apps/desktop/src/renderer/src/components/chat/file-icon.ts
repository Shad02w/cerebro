import { fileIconName } from './file-icon-names'

const icons = import.meta.glob<string>('../markdown/language-icons/*.svg', {
  eager: true,
  query: '?url',
  import: 'default'
})

/** SVGL logo URL for a workspace-relative path, or null for a generic file glyph. */
export function fileIconUrl(relativePath: string): string | null {
  const name = fileIconName(relativePath)
  if (!name) return null
  return icons[`../markdown/language-icons/${name}.svg`] ?? null
}
