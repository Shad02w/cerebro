import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chmod } from 'node:fs/promises'

/** Restrict daemon secrets/runtime to this user, including Windows ACL inheritance. */
export async function protectDirectory(path: string): Promise<void> {
  if (process.platform !== 'win32') {
    await chmod(path, 0o700)
    return
  }
  const exec = promisify(execFile)
  const { stdout } = await exec('whoami.exe', [], { windowsHide: true })
  await exec('icacls.exe', [path, '/inheritance:r', '/grant:r', `${stdout.trim()}:(OI)(CI)F`], {
    windowsHide: true
  })
}
