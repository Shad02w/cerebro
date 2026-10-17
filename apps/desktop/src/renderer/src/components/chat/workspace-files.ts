export type WorkspaceFileIndex = {
  current: ReadonlySet<string>
  /** Bumped for each directory read. An older read must not replace a newer one. */
  generation: number
}

/** Reads the workspace directory. Each call sees the files that exist now. */
export function loadWorkspaceFiles(workspaceId: number): Promise<readonly string[]> {
  return window.cerebro
    .listWorkspaceFiles(workspaceId)
    .then((files) => files)
    .catch(() => [] as string[])
}

/**
 * One directory read for an open `@` menu. Typing more of the query reuses that
 * read; the next `@` reads the directory again, including files added since.
 */
export function createMentionFileListing(
  workspaceId: { current: number | null },
  index: WorkspaceFileIndex
): { begin: () => void; files: () => Promise<readonly string[]> } {
  let session: { id: number; files: Promise<readonly string[]> } | null = null
  return {
    begin() {
      session = null
    },
    files() {
      const id = workspaceId.current
      if (id == null) return Promise.resolve([])
      if (!session || session.id !== id) {
        const generation = ++index.generation
        const files = loadWorkspaceFiles(id).then((listed) => {
          if (index.generation === generation) index.current = new Set(listed)
          return listed
        })
        session = { id, files }
      }
      return session.files
    }
  }
}
