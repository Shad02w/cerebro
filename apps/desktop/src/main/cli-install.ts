import { execFileSync } from 'node:child_process'
import { app, ipcMain } from 'electron'
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { IPC } from '../shared/ipc'
import type { CliInstallStatus } from '../shared/types'
import { getCerebroHome } from './paths'

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

function locations(): {
  home: string
  command: string
  bin: string
  profile: string
  bundle: string
  owner: string
  block: string
  shell: string
  launcher: string
} {
  const testing = !app.isPackaged && process.env.NODE_ENV === 'test'
  const home =
    testing && process.env.CEREBRO_CLI_TEST_HOME ? process.env.CEREBRO_CLI_TEST_HOME : homedir()
  const command = app.isPackaged ? 'cerebro' : 'cerebro-dev'
  const bin = join(home, '.local/bin')
  const shell = basename(process.env.SHELL || '/bin/zsh')
  const profile =
    shell === 'zsh'
      ? join(testing ? home : process.env.ZDOTDIR || home, '.zshrc')
      : join(home, process.platform === 'darwin' ? '.bash_profile' : '.bashrc')
  const bundle = app.isPackaged ? join(process.resourcesPath, 'cli') : resolve(__dirname, '../cli')
  const owner = `# Cerebro CLI launcher v1: ${command}\n`
  const block = `\n# >>> Cerebro ${command} PATH >>>\nexport PATH=${quote(bin)}:"$PATH"\n# <<< Cerebro ${command} PATH <<<\n`
  return { home, command, bin, profile, bundle, owner, block, shell, launcher: join(bin, command) }
}

function readRegular(file: string): string | null {
  try {
    if (!lstatSync(file).isFile())
      throw new Error(`${file} is not a regular file. Cerebro will not replace it.`)
    return readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** Dotfile managers commonly link shell profiles. Write the target, never replace the link. */
function resolveProfile(file: string): string {
  try {
    lstatSync(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return file
    throw error
  }
  // Resolve outside the missing-file catch: dangling links must not be overwritten.
  return realpathSync(file)
}

function binOnPath(): boolean {
  const bin = resolve(locations().bin)
  return (process.env.PATH ?? '')
    .split(delimiter)
    .some((entry) => isAbsolute(entry) && resolve(entry) === bin)
}

function managesProfile(launcher: string): boolean {
  // Older launchers always installed a profile block.
  return !launcher.includes('# Cerebro CLI manages PATH: false\n')
}

function launcherText(managePath: boolean): string {
  const { bundle, owner } = locations()
  const node = join(bundle, 'node')
  const entry = join(bundle, 'cerebro.cjs')
  return `#!/bin/sh\n${owner}# Cerebro CLI manages PATH: ${managePath}\nif [ ! -x ${quote(node)} ] || [ ! -f ${quote(entry)} ]; then\n  echo 'Cerebro CLI files are missing. Open Cerebro Settings > CLI and repair the installation.' >&2\n  exit 1\nfi\nif [ -z "\${CEREBRO_HOME:-}" ]; then\n  export CEREBRO_HOME=${quote(getCerebroHome())}\nfi\nexec ${quote(node)} --no-warnings ${quote(entry)} "$@"\n`
}

function supported(): string | null {
  if (process.env.APPIMAGE)
    return 'Install Cerebro in a permanent directory before installing the CLI. Portable AppImage mounts change between launches.'
  if (!['zsh', 'bash'].includes(locations().shell))
    return 'One-click CLI installation currently supports zsh and bash.'
  return null
}

export function getCliStatus(): CliInstallStatus {
  if (process.platform === 'win32') return windowsCliStatus()
  const { launcher, command, profile, owner, block, bundle } = locations()
  const base = {
    command,
    path: launcher,
    profile,
    development: !app.isPackaged,
    version: app.getVersion(),
    onPath: binOnPath()
  }
  const unsupported = supported()
  if (unsupported) return { ...base, state: 'unsupported', message: unsupported }
  try {
    const text = readRegular(launcher)
    const pathReady = base.onPath || (readRegular(resolveProfile(profile)) ?? '').includes(block)
    if (text !== null && !text.startsWith(`#!/bin/sh\n${owner}`)) {
      return {
        ...base,
        state: 'conflict',
        message:
          'Another file owns this command location. Move it yourself before installing Cerebro CLI.'
      }
    }
    if (text === null)
      return {
        ...base,
        state: 'not-installed',
        message: `Install ${command} for use in your terminal.`
      }
    const ready = existsSync(join(bundle, 'node')) && existsSync(join(bundle, 'cerebro.cjs'))
    let executable = true
    try {
      accessSync(launcher, constants.X_OK)
    } catch {
      executable = false
    }
    return {
      ...base,
      state:
        text === launcherText(managesProfile(text)) && pathReady && ready && executable
          ? 'installed'
          : 'repair',
      message: 'Open a new terminal after installation. Git commands require Git to be installed.'
    }
  } catch (error) {
    return { ...base, state: 'conflict', message: (error as Error).message }
  }
}

function atomicWrite(file: string, text: string, mode: number): void {
  const temporary = `${file}.cerebro-${process.pid}.tmp`
  try {
    writeFileSync(temporary, text, { mode, flag: 'wx' })
    renameSync(temporary, file)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

function assertOwned(text: string | null): void {
  if (text !== null && !text.startsWith(`#!/bin/sh\n${locations().owner}`)) {
    throw new Error('This command was not installed by Cerebro. It has been left unchanged.')
  }
}

function profileWithoutBlock(text: string): string {
  const { block, command } = locations()
  const clean = text.replace(block, '')
  if (
    clean.includes(`# >>> Cerebro ${command} PATH >>>`) ||
    clean.includes(`# <<< Cerebro ${command} PATH <<<`)
  ) {
    throw new Error(
      'The Cerebro PATH block was edited. Restore or remove that block in your shell configuration before trying again.'
    )
  }
  return clean
}

export function installCli(): CliInstallStatus {
  if (process.platform === 'win32') return installWindowsCli()
  const unsupported = supported()
  if (unsupported) throw new Error(unsupported)
  const { launcher, bundle, profile, block, bin } = locations()
  const previous = readRegular(launcher)
  assertOwned(previous)
  accessSync(join(bundle, 'node'), constants.X_OK)
  accessSync(join(bundle, 'cerebro.cjs'), constants.R_OK)
  if (binOnPath()) {
    mkdirSync(bin, { recursive: true })
    atomicWrite(launcher, launcherText(previous !== null && managesProfile(previous)), 0o755)
    return getCliStatus()
  }
  const profileTarget = resolveProfile(profile)
  const profileText = readRegular(profileTarget) ?? ''
  const nextProfile = profileWithoutBlock(profileText) + block
  mkdirSync(bin, { recursive: true })
  mkdirSync(dirname(profileTarget), { recursive: true })
  atomicWrite(launcher, launcherText(true), 0o755)
  try {
    atomicWrite(
      profileTarget,
      nextProfile,
      existsSync(profileTarget) ? lstatSync(profileTarget).mode & 0o777 : 0o644
    )
  } catch (error) {
    if (previous === null) unlinkSync(launcher)
    else atomicWrite(launcher, previous, 0o755)
    throw error
  }
  return getCliStatus()
}

export function removeCli(): CliInstallStatus {
  if (process.platform === 'win32') return removeWindowsCli()
  const unsupported = supported()
  if (unsupported) throw new Error(unsupported)
  const { launcher, profile } = locations()
  const previous = readRegular(launcher)
  assertOwned(previous)
  if (previous !== null && !managesProfile(previous)) {
    unlinkSync(launcher)
    return getCliStatus()
  }
  const profileTarget = resolveProfile(profile)
  const profileText = readRegular(profileTarget)
  if (profileText !== null) {
    const clean = profileWithoutBlock(profileText)
    if (clean !== profileText)
      atomicWrite(profileTarget, clean, lstatSync(profileTarget).mode & 0o777)
  }
  if (previous !== null) unlinkSync(launcher)
  return getCliStatus()
}

export function registerCliIpc(): void {
  ipcMain.handle(IPC.cli.status, getCliStatus)
  ipcMain.handle(IPC.cli.install, installCli)
  ipcMain.handle(IPC.cli.remove, removeCli)
}

const WINDOWS_OWNER = '@echo off\r\nrem Cerebro CLI launcher v1\r\n'
function windowsLauncher(): { path: string; text: string } {
  const { bin, command, bundle } = locations()
  const escape = (value: string): string => value.replaceAll('%', '%%')
  return {
    path: join(bin, `${command}.cmd`),
    text: `${WINDOWS_OWNER}setlocal DisableDelayedExpansion\r\nif not defined CEREBRO_HOME set "CEREBRO_HOME=${escape(getCerebroHome())}"\r\n"${escape(join(bundle, 'node.exe'))}" --no-warnings "${escape(join(bundle, 'cerebro.cjs'))}" %*\r\n`
  }
}
function windowsCliStatus(): CliInstallStatus {
  const { command, bundle } = locations()
  const launcher = windowsLauncher()
  const base = {
    command,
    path: launcher.path,
    profile: 'User PATH',
    development: !app.isPackaged,
    version: app.getVersion(),
    onPath: binOnPath()
  }
  try {
    const text = readRegular(launcher.path)
    if (text && !text.startsWith(WINDOWS_OWNER))
      return { ...base, state: 'conflict', message: 'Another application owns this launcher.' }
    if (text === null)
      return {
        ...base,
        state: 'not-installed',
        message: `Install ${command} for use in your terminal.`
      }
    const ready =
      text === launcher.text &&
      existsSync(join(bundle, 'node.exe')) &&
      existsSync(join(bundle, 'cerebro.cjs'))
    return {
      ...base,
      state: ready ? 'installed' : 'repair',
      message: 'Open a new terminal after installation. Git commands require Git to be installed.'
    }
  } catch (error) {
    return { ...base, state: 'conflict', message: String(error) }
  }
}
function installWindowsCli(): CliInstallStatus {
  const launcher = windowsLauncher()
  const { bin } = locations()
  const previous = readRegular(launcher.path)
  if (previous && !previous.startsWith(WINDOWS_OWNER))
    throw new Error('Another application owns this launcher.')
  mkdirSync(bin, { recursive: true })
  atomicWrite(launcher.path, launcher.text, 0o755)
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$p=[string][Environment]::GetEnvironmentVariable('Path','User'); $b=$env:CEREBRO_INSTALL_BIN; if (($p -split ';') -notcontains $b) {[Environment]::SetEnvironmentVariable('Path',(($p.TrimEnd(';')+';'+$b).TrimStart(';')),'User')}"
      ],
      { env: { ...process.env, CEREBRO_INSTALL_BIN: bin }, windowsHide: true }
    )
  } catch (error) {
    if (previous === null) unlinkSync(launcher.path)
    else atomicWrite(launcher.path, previous, 0o755)
    throw error
  }
  return windowsCliStatus()
}
function removeWindowsCli(): CliInstallStatus {
  const launcher = windowsLauncher()
  const text = readRegular(launcher.path)
  if (text && !text.startsWith(WINDOWS_OWNER))
    throw new Error('Another application owns this launcher.')
  if (text !== null) unlinkSync(launcher.path)
  // The shared user bin directory may contain other commands; retain its PATH entry.
  return windowsCliStatus()
}
