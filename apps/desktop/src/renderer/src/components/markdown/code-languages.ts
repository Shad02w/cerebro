/** Language tags a code fence may use, mapped to a display name and an icon from `./language-icons`. */
export type CodeLanguage = { label: string; icon: string | null }

const icons = import.meta.glob<string>('./language-icons/*.svg', {
  eager: true,
  query: '?url',
  import: 'default'
})

const iconUrl = (name: string): string => {
  const url = icons[`./language-icons/${name}.svg`]
  if (!url) throw new Error(`Missing code language icon: ${name}`)
  return url
}

// [fence tags, label, icon file]
const languages: Array<[string[], string, string]> = [
  [['typescript', 'ts', 'mts', 'cts'], 'TypeScript', 'typescript'],
  [['tsx'], 'TSX', 'typescript'],
  [['javascript', 'js', 'mjs', 'cjs'], 'JavaScript', 'javascript'],
  [['jsx'], 'JSX', 'javascript'],
  [['python', 'py'], 'Python', 'python'],
  [['rust', 'rs'], 'Rust', 'rust'],
  [['go', 'golang'], 'Go', 'golang'],
  [['java'], 'Java', 'java'],
  [['kotlin', 'kt', 'kts'], 'Kotlin', 'kotlin'],
  [['swift'], 'Swift', 'swift'],
  [['ruby', 'rb'], 'Ruby', 'ruby'],
  [['php'], 'PHP', 'php'],
  [['c', 'h'], 'C', 'c'],
  [['cpp', 'c++', 'cc', 'cxx', 'hpp'], 'C++', 'c-plusplus'],
  [['csharp', 'cs', 'c#'], 'C#', 'csharp'],
  [['bash', 'sh', 'shell', 'shellscript', 'zsh'], 'Shell', 'bash'],
  [['powershell', 'ps1', 'pwsh'], 'PowerShell', 'powershell'],
  [['json', 'jsonc', 'json5'], 'JSON', 'json'],
  [['html', 'htm'], 'HTML', 'html5'],
  [['css'], 'CSS', 'css'],
  [['scss', 'sass'], 'Sass', 'sass'],
  [['markdown', 'md'], 'Markdown', 'markdown'],
  [['graphql', 'gql'], 'GraphQL', 'graphql'],
  [['svg'], 'SVG', 'svg'],
  [['lua'], 'Lua', 'lua'],
  [['dart'], 'Dart', 'dart'],
  [['scala'], 'Scala', 'scala'],
  [['haskell', 'hs'], 'Haskell', 'haskell'],
  [['r'], 'R', 'r'],
  [['julia', 'jl'], 'Julia', 'julia'],
  [['zig'], 'Zig', 'zig'],
  [['solidity', 'sol'], 'Solidity', 'solidity'],
  [['terraform', 'tf', 'hcl'], 'Terraform', 'terraform'],
  [['matlab'], 'MATLAB', 'matlab'],
  [['fortran'], 'Fortran', 'fortran'],
  [['cobol'], 'COBOL', 'cobol'],
  [['gleam'], 'Gleam', 'gleam']
]

const byTag = new Map<string, CodeLanguage>(
  languages.flatMap(([tags, label, icon]) =>
    tags.map((tag): [string, CodeLanguage] => [tag, { label, icon: iconUrl(icon) }])
  )
)

/** Looks up a fence tag. Unknown tags keep their text and get no brand icon. */
export function codeLanguage(tag: string | undefined): CodeLanguage {
  if (!tag) return { label: 'Text', icon: null }
  return byTag.get(tag.toLowerCase()) ?? { label: tag, icon: null }
}
