import {
  Bot,
  FilePen,
  FilePlus,
  FileText,
  FolderSearch,
  GitBranch,
  Globe,
  Image,
  ListChecks,
  ListTodo,
  MessageCircle,
  NotebookPen,
  Plug,
  Sparkles,
  Terminal,
  TextSearch,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toolIconName, type ToolIconName } from './tool-icon'

const icons: Record<ToolIconName, LucideIcon> = {
  shell: Terminal,
  web: Globe,
  grep: TextSearch,
  glob: FolderSearch,
  read: FileText,
  edit: FilePen,
  write: FilePlus,
  notebook: NotebookPen,
  todo: ListTodo,
  agent: Bot,
  question: MessageCircle,
  skill: Sparkles,
  mcp: Plug,
  image: Image,
  plan: ListChecks,
  git: GitBranch,
  tool: Wrench
}

export function ToolTypeIcon({
  title,
  name,
  className
}: {
  title?: string
  name?: ToolIconName
  className?: string
}): React.JSX.Element {
  const icon = name ?? toolIconName(title)
  const Icon = icons[icon]
  return (
    <Icon className={cn('size-3.5 shrink-0', className)} aria-hidden="true" data-tool-icon={icon} />
  )
}
