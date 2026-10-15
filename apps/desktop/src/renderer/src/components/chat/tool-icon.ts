/** Icon id for a tool call, matched from the harness tool name. */
export type ToolIconName =
  | 'shell'
  | 'web'
  | 'grep'
  | 'glob'
  | 'read'
  | 'edit'
  | 'write'
  | 'notebook'
  | 'todo'
  | 'agent'
  | 'question'
  | 'skill'
  | 'mcp'
  | 'image'
  | 'plan'
  | 'git'
  | 'tool'

const rules: Array<[RegExp, ToolIconName]> = [
  [/^(bash|shell|powershell|cmd|terminal|commandexecution)$/, 'shell'],
  [/web(search|fetch)|browse/, 'web'],
  [/toolsearch/, 'grep'],
  [/grep|^rg$|textsearch/, 'grep'],
  [/glob|foldersearch|findfiles/, 'glob'],
  [/notebook/, 'notebook'],
  [/multiedit|^edit|strreplace|applypatch/, 'edit'],
  [/^write|createfile/, 'write'],
  [/todo|task(create|update|list|get|stop|output)/, 'todo'],
  [/askuser|question/, 'question'],
  [/skill/, 'skill'],
  [/mcp/, 'mcp'],
  [/image/, 'image'],
  [/plan/, 'plan'],
  [/^task|subagent|agent|collab/, 'agent'],
  [/git/, 'git'],
  [/^read|readfile/, 'read']
]

/** Pick an icon from a tool title such as `Bash`, `WebSearch`, or `mcpToolCall`. */
export function toolIconName(title: string | undefined): ToolIconName {
  const name = (title ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const [pattern, icon] of rules) if (pattern.test(name)) return icon
  return 'tool'
}
