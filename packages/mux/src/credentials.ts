import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { databasePath, muxDirectory } from './paths'

export type InstallationState = {
  token: string | null
  database: boolean
}

/** `accept` the peer, `reject` a peer that does not know the current token, or `reset` because this process is holding deleted files. */
export type HandshakeDecision = 'accept' | 'reject' | 'reset'

/**
 * The token file is the credential. A daemon must not keep a private copy: if the file is
 * replaced, the next hello presents the new contents and is accepted.
 * A missing database means this process is still serving a deleted file, so it has to exit
 * before a new daemon can create a fresh one. A wrong token while that file is still present
 * is rejected and the daemon stays up.
 */
export function decideHandshake(
  presented: unknown,
  installation: InstallationState
): HandshakeDecision {
  if (!installation.database) return 'reset'
  if (
    installation.token === null ||
    typeof presented !== 'string' ||
    presented !== installation.token
  )
    return 'reject'
  return 'accept'
}

export async function readInstallation(): Promise<InstallationState> {
  let token: string | null
  try {
    token = await readFile(join(muxDirectory(), 'token'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    token = null
  }
  let database = true
  try {
    await access(databasePath())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    database = false
  }
  return { token, database }
}
