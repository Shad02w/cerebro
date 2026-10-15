/**
 * SVGL logo stem for a workspace-relative path.
 * Stems match files in `components/markdown/language-icons`, which are vendored from svgl.
 */
const byExtension: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'golang',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  h: 'c',
  cpp: 'c-plusplus',
  cc: 'c-plusplus',
  cxx: 'c-plusplus',
  hpp: 'c-plusplus',
  hh: 'c-plusplus',
  cs: 'csharp',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  json: 'json',
  html: 'html5',
  htm: 'html5',
  css: 'css',
  scss: 'sass',
  sass: 'sass',
  md: 'markdown',
  mdx: 'markdown',
  graphql: 'graphql',
  gql: 'graphql',
  svg: 'svg',
  lua: 'lua',
  dart: 'dart',
  scala: 'scala',
  hs: 'haskell',
  r: 'r',
  jl: 'julia',
  zig: 'zig',
  sol: 'solidity',
  tf: 'terraform',
  vue: 'vue',
  svelte: 'svelte'
}

const byBasename: Record<string, string> = {
  dockerfile: 'docker',
  'package.json': 'npm',
  'package-lock.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'pnpm-lock.yml': 'pnpm'
}

/** Logo stem for a relative path, or null when svgl has no matching mark. */
export function fileIconName(relativePath: string): string | null {
  const base = relativePath.split('/').pop()?.toLowerCase() ?? ''
  if (!base) return null
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'docker'
  if (base.startsWith('docker-compose.')) return 'docker'
  const named = byBasename[base]
  if (named) return named
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return null
  return byExtension[base.slice(dot + 1)] ?? null
}
