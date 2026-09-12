import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import { FileTree, useFileTree, useFileTreeSelector } from '@pierre/trees/react'
import type { RepoChangeGroup } from '@shared/types'
import { changeItemId } from '@/lib/changes'

type ChangesFileListProps = {
  groups: RepoChangeGroup[]
  selectedId: string | null
  onSelect: (itemId: string) => void
}

const TREE_STYLE = {
  '--trees-bg-override': 'var(--background)',
  '--trees-fg-override': 'var(--foreground)',
  '--trees-fg-muted-override': 'var(--muted-foreground)',
  '--trees-bg-muted-override': 'var(--muted)',
  '--trees-selected-bg-override': 'var(--muted)',
  '--trees-selected-fg-override': 'var(--foreground)',
  '--trees-focus-ring-color-override': 'var(--sidebar-selected)',
  '--trees-font-family-override': 'inherit',
  '--trees-font-size-override': '12px'
} as CSSProperties

function directoryPaths(paths: string[]): string[] {
  const directories = new Set<string>()
  for (const path of paths) {
    const parts = path.split('/')
    for (let depth = 1; depth < parts.length; depth++) {
      directories.add(parts.slice(0, depth).join('/') + '/')
    }
  }
  return [...directories]
}

function RepositoryTree({
  group,
  selectedId,
  onSelect
}: Omit<ChangesFileListProps, 'groups'> & { group: RepoChangeGroup }): React.JSX.Element {
  const paths = useMemo(() => group.files.map((file) => file.path), [group.files])
  const callbacks = useRef({ onSelect, repositoryId: group.repositoryId })
  useLayoutEffect(() => {
    callbacks.current = { onSelect, repositoryId: group.repositoryId }
  }, [onSelect, group.repositoryId])
  const syncing = useRef(false)
  const { model } = useFileTree({
    paths,
    initialExpansion: 'closed',
    initialExpandedPaths: directoryPaths(paths),
    flattenEmptyDirectories: false,
    density: 'compact',
    onSelectionChange: (selectedPaths) => {
      if (syncing.current) return
      const path = selectedPaths.at(-1)
      if (!path || model.getItem(path)?.isDirectory()) return
      callbacks.current.onSelect(changeItemId(callbacks.current.repositoryId, path))
    }
  })
  const previousPaths = useRef(paths)
  useEffect(() => {
    if (paths === previousPaths.current) return
    // resetPaths rebuilds expansion; carry existing folder choices into the new tree.
    const directories = directoryPaths(paths)
    const expanded = directories.filter((path) => {
      const item = model.getItem(path)
      return !item || ('isExpanded' in item && item.isExpanded())
    })
    syncing.current = true
    try {
      model.resetPaths(paths, { initialExpandedPaths: expanded })
      // Initial expansion also opens ancestors; restore collapsed parents last.
      const expandedSet = new Set(expanded)
      for (const path of directories) {
        const item = model.getItem(path)
        if (!expandedSet.has(path) && item && 'collapse' in item) item.collapse()
      }
      previousPaths.current = paths
    } finally {
      syncing.current = false
    }
  }, [model, paths])
  useEffect(() => {
    model.setGitStatus(group.files.map(({ path, status }) => ({ path, status })))
  }, [model, group.files])
  useEffect(() => {
    syncing.current = true
    try {
      const path = paths.find((path) => changeItemId(group.repositoryId, path) === selectedId)
      for (const selected of model.getSelectedPaths()) {
        if (selected !== path) model.getItem(selected)?.deselect()
      }
      if (path) model.getItem(path)?.select()
    } finally {
      syncing.current = false
    }
  }, [model, paths, group.repositoryId, selectedId])
  const count = useFileTreeSelector(model, (tree) => tree.getVisibleCount())

  return (
    <FileTree
      model={model}
      aria-label={`${group.repositoryName} changed files`}
      onClickCapture={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        // Selection-change events omit repeated activation of the selected file.
        // Read the composed path because Pierre renders rows inside a shadow root.
        const row = event.nativeEvent
          .composedPath()
          .find(
            (target): target is HTMLElement =>
              target instanceof HTMLElement && target.dataset.itemType === 'file'
          )
        const path = row?.dataset.itemPath
        if (path && changeItemId(group.repositoryId, path) === selectedId) onSelect(selectedId)
      }}
      style={{ ...TREE_STYLE, height: count * model.getItemHeight() }}
    />
  )
}

export function ChangesFileList({
  groups,
  selectedId,
  onSelect
}: ChangesFileListProps): React.JSX.Element {
  return (
    <div data-testid="changes-file-list" className="min-h-0 flex-1 overflow-auto px-1 py-1">
      {groups
        .filter((group) => group.files.length > 0)
        .map((group) => (
          <div
            key={group.repositoryId}
            data-testid="changes-repo-group"
            data-repo-name={group.repositoryName}
          >
            {groups.length > 1 && (
              <div
                data-testid="changes-repo-header"
                className="px-1.5 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
              >
                {group.repositoryName}
              </div>
            )}
            <RepositoryTree group={group} selectedId={selectedId} onSelect={onSelect} />
          </div>
        ))}
    </div>
  )
}
