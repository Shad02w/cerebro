import { ChevronRight } from 'lucide-react'
import type { ChangedFile, RepoChangeGroup } from '@shared/types'
import { cn } from '@/lib/utils'
import { changeItemId } from '@/lib/changes'

export type ChangesListMode = 'flat' | 'tree'

type ChangesFileListProps = {
  groups: RepoChangeGroup[]
  mode: ChangesListMode
  selectedId: string | null
  onSelect: (itemId: string) => void
}

type TreeNode =
  | { type: 'dir'; name: string; path: string; children: TreeNode[] }
  | { type: 'file'; name: string; path: string; file: ChangedFile; repositoryId: number }

function statusLetter(status: ChangedFile['status']): string {
  switch (status) {
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'untracked':
      return 'U'
    default:
      return 'M'
  }
}

function statusClass(status: ChangedFile['status']): string {
  switch (status) {
    case 'added':
    case 'untracked':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'deleted':
      return 'text-red-500'
    default:
      return 'text-amber-600 dark:text-amber-400'
  }
}

function fileName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

function buildTree(repositoryId: number, files: ChangedFile[]): TreeNode[] {
  type MutableDir = {
    name: string
    path: string
    files: Array<{ name: string; file: ChangedFile }>
    dirs: Map<string, MutableDir>
  }

  const root: MutableDir = { name: '', path: '', files: [], dirs: new Map() }

  const ensureDir = (parent: MutableDir, name: string): MutableDir => {
    let next = parent.dirs.get(name)
    if (!next) {
      const path = parent.path ? `${parent.path}/${name}` : name
      next = { name, path, files: [], dirs: new Map() }
      parent.dirs.set(name, next)
    }
    return next
  }

  for (const file of files) {
    const parts = file.path.split('/')
    let current = root
    for (let index = 0; index < parts.length - 1; index += 1) {
      const segment = parts[index]
      if (!segment) continue
      current = ensureDir(current, segment)
    }
    current.files.push({ name: parts[parts.length - 1] || file.path, file })
  }

  const toNodes = (dir: MutableDir): TreeNode[] => {
    const dirs: TreeNode[] = [...dir.dirs.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((child) => ({
        type: 'dir' as const,
        name: child.name,
        path: child.path,
        children: toNodes(child)
      }))
    const fileNodes: TreeNode[] = dir.files
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => ({
        type: 'file' as const,
        name: entry.name,
        path: entry.file.path,
        file: entry.file,
        repositoryId
      }))
    return [...dirs, ...fileNodes]
  }

  return toNodes(root)
}

function FileRow({
  repositoryId,
  file,
  selected,
  indent,
  onSelect
}: {
  repositoryId: number
  file: ChangedFile
  selected: boolean
  indent: number
  onSelect: (itemId: string) => void
}): React.JSX.Element {
  const itemId = changeItemId(repositoryId, file.path)
  return (
    <button
      type="button"
      data-testid="changes-file-row"
      data-path={file.path}
      data-repo-id={String(repositoryId)}
      data-item-id={itemId}
      data-selected={selected ? 'true' : 'false'}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-left text-xs',
        selected ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/60'
      )}
      style={{ paddingLeft: indent }}
      onClick={(): void => onSelect(itemId)}
    >
      <span className={cn('w-3 shrink-0 font-mono text-[10px]', statusClass(file.status))}>
        {statusLetter(file.status)}
      </span>
      <span className="min-w-0 truncate" title={file.path}>
        {fileName(file.path)}
      </span>
    </button>
  )
}

function TreeRows({
  nodes,
  depth,
  selectedId,
  onSelect
}: {
  nodes: TreeNode[]
  depth: number
  selectedId: string | null
  onSelect: (itemId: string) => void
}): React.JSX.Element {
  return (
    <>
      {nodes.map((node) =>
        node.type === 'dir' ? (
          <div key={`dir:${node.path}`} data-testid="changes-tree-dir" data-path={node.path}>
            <div
              className="flex items-center gap-1 px-1.5 py-0.5 text-xs text-muted-foreground"
              style={{ paddingLeft: 8 + depth * 12 }}
            >
              <ChevronRight className="size-3 rotate-90" />
              <span className="truncate">{node.name}</span>
            </div>
            <TreeRows
              nodes={node.children}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          </div>
        ) : (
          <FileRow
            key={changeItemId(node.repositoryId, node.path)}
            repositoryId={node.repositoryId}
            file={node.file}
            selected={selectedId === changeItemId(node.repositoryId, node.path)}
            indent={20 + depth * 12}
            onSelect={onSelect}
          />
        )
      )}
    </>
  )
}

export function ChangesFileList({
  groups,
  mode,
  selectedId,
  onSelect
}: ChangesFileListProps): React.JSX.Element {
  const showRepoHeaders = groups.length > 1
  const visibleGroups = groups.filter((group) => group.files.length > 0)

  return (
    <div
      data-testid="changes-file-list"
      data-mode={mode}
      className="min-h-0 flex-1 overflow-auto px-1 py-1"
    >
      {visibleGroups.map((group) => (
        <div
          key={group.repositoryId}
          data-testid="changes-repo-group"
          data-repo-name={group.repositoryName}
          className="mb-1"
        >
          {showRepoHeaders ? (
            <div
              data-testid="changes-repo-header"
              className="px-1.5 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
            >
              {group.repositoryName}
            </div>
          ) : null}
          {mode === 'flat' ? (
            group.files.map((file) => (
              <FileRow
                key={changeItemId(group.repositoryId, file.path)}
                repositoryId={group.repositoryId}
                file={file}
                selected={selectedId === changeItemId(group.repositoryId, file.path)}
                indent={8}
                onSelect={onSelect}
              />
            ))
          ) : (
            <TreeRows
              nodes={buildTree(group.repositoryId, group.files)}
              depth={0}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          )}
        </div>
      ))}
    </div>
  )
}
