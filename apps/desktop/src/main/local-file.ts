import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isLocalSource } from '../shared/media'

function decode(value: string): string {
  try {
    return decodeURI(value)
  } catch {
    return value
  }
}

/**
 * Turns an agent-written local source into an absolute path. Remote sources are rejected, since a
 * model-written URL could carry data out of the app.
 */
export function resolveLocalFilePath(source: string): string {
  const value = source.trim()
  if (!isLocalSource(value)) throw new Error('Only local files can be shown.')
  let path: string
  if (/^file:/i.test(value)) path = fileURLToPath(value)
  else if (value === '~' || value.startsWith('~/')) path = join(homedir(), decode(value.slice(1)))
  else path = decode(value)
  if (!isAbsolute(path)) throw new Error('Only absolute file paths can be shown.')
  return path
}
