import { BrowserWindow, shell } from 'electron'
import { Octokit } from '@octokit/rest'
import { IPC } from '../shared/ipc'
import type { GitHubAccount, GitHubStatus } from '../shared/types'
import { deleteGitHubToken, readGitHubToken, storeGitHubToken } from './secret-store'

const DEVICE_SCOPES = 'repo read:user'
const DEFAULT_LOGIN_URL = 'https://github.com'
const DEFAULT_API_URL = 'https://api.github.com'

type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

type TokenSuccessResponse = {
  access_token: string
  token_type?: string
  scope?: string
}

type TokenErrorResponse = {
  error: string
  error_description?: string
  interval?: number
}

type PendingFlow = {
  generation: number
  userCode: string
  verificationUri: string
  expiresAt: string
  abort: AbortController
}

let pendingFlow: PendingFlow | null = null
let cachedAccount: GitHubAccount | null = null
let flowGeneration = 0

function getClientId(): string | null {
  // Runtime override for tests / local experiments; baked MAIN_VITE_ ships with the app.
  const fromProcess = process.env.CEREBRO_GITHUB_CLIENT_ID?.trim()
  if (fromProcess) return fromProcess
  const fromVite = import.meta.env.MAIN_VITE_GITHUB_CLIENT_ID?.trim()
  return fromVite || null
}

function getLoginUrl(): string {
  return (process.env.CEREBRO_GITHUB_LOGIN_URL?.trim() || DEFAULT_LOGIN_URL).replace(/\/$/, '')
}

function getApiUrl(): string {
  return (process.env.CEREBRO_GITHUB_API_URL?.trim() || DEFAULT_API_URL).replace(/\/$/, '')
}

function broadcastStatus(status: GitHubStatus): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC.github.status, status)
    }
  }
}

function setStatus(status: GitHubStatus): GitHubStatus {
  broadcastStatus(status)
  return status
}

async function fetchJson<T>(
  url: string,
  init: RequestInit & { signal?: AbortSignal }
): Promise<T> {
  const response = await fetch(url, init)
  const text = await response.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text) as unknown
    } catch {
      throw new Error(`Unexpected response from GitHub (${response.status}).`)
    }
  }
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error_description' in body
        ? String((body as { error_description?: string }).error_description)
        : body && typeof body === 'object' && 'message' in body
          ? String((body as { message?: string }).message)
          : `GitHub request failed (${response.status}).`
    throw new Error(message)
  }
  return body as T
}

async function fetchAuthenticatedUser(token: string): Promise<GitHubAccount> {
  const octokit = new Octokit({
    auth: token,
    baseUrl: getApiUrl()
  })
  const { data } = await octokit.users.getAuthenticated()
  return {
    login: data.login,
    name: data.name ?? null,
    avatarUrl: data.avatar_url
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

async function pollForAccessToken(
  deviceCode: string,
  intervalSeconds: number,
  signal: AbortSignal,
  generation: number
): Promise<string> {
  let intervalMs = Math.max(1, intervalSeconds) * 1000
  const tokenUrl = `${getLoginUrl()}/login/oauth/access_token`
  const clientId = getClientId()
  if (!clientId) {
    throw new Error('GitHub client ID is not configured.')
  }

  while (!signal.aborted) {
    await sleep(intervalMs, signal)

    const body = new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body,
      signal
    })

    const text = await response.text()
    let parsed: TokenSuccessResponse | TokenErrorResponse
    try {
      parsed = JSON.parse(text) as TokenSuccessResponse | TokenErrorResponse
    } catch {
      throw new Error('Unexpected token response from GitHub.')
    }

    if ('access_token' in parsed && parsed.access_token) {
      if (generation !== flowGeneration) {
        throw new DOMException('Aborted', 'AbortError')
      }
      return parsed.access_token
    }

    const errorCode = 'error' in parsed ? parsed.error : undefined
    if (errorCode === 'authorization_pending') {
      continue
    }
    if (errorCode === 'slow_down') {
      const next = 'interval' in parsed && typeof parsed.interval === 'number' ? parsed.interval : 0
      intervalMs = Math.max(intervalMs + 5000, next * 1000)
      continue
    }
    if (errorCode === 'expired_token') {
      throw new Error('The device code expired. Try connecting again.')
    }
    if (errorCode === 'access_denied') {
      throw new Error('GitHub authorization was denied.')
    }
    if (errorCode === 'incorrect_device_code') {
      throw new Error('The device code was rejected. Try connecting again.')
    }

    const description =
      'error_description' in parsed && parsed.error_description
        ? parsed.error_description
        : 'GitHub authorization failed.'
    throw new Error(description)
  }

  throw new DOMException('Aborted', 'AbortError')
}

async function runDeviceFlow(
  deviceCode: string,
  intervalSeconds: number,
  signal: AbortController,
  generation: number
): Promise<void> {
  try {
    const token = await pollForAccessToken(deviceCode, intervalSeconds, signal.signal, generation)
    if (generation !== flowGeneration) return

    storeGitHubToken(token)
    const account = await fetchAuthenticatedUser(token)
    if (generation !== flowGeneration) return

    cachedAccount = account
    pendingFlow = null
    setStatus({ state: 'connected', account })
  } catch (error) {
    if (generation !== flowGeneration || isAbortError(error)) {
      return
    }
    pendingFlow = null
    cachedAccount = null
    setStatus({
      state: 'error',
      message: error instanceof Error ? error.message : 'GitHub authorization failed.'
    })
  }
}

export async function getGitHubStatus(): Promise<GitHubStatus> {
  if (!getClientId()) {
    return { state: 'unconfigured' }
  }

  if (pendingFlow) {
    return {
      state: 'pending',
      userCode: pendingFlow.userCode,
      verificationUri: pendingFlow.verificationUri,
      expiresAt: pendingFlow.expiresAt
    }
  }

  if (cachedAccount) {
    return { state: 'connected', account: cachedAccount }
  }

  const token = readGitHubToken()
  if (!token) {
    return { state: 'disconnected' }
  }

  try {
    const account = await fetchAuthenticatedUser(token)
    cachedAccount = account
    return { state: 'connected', account }
  } catch (error) {
    deleteGitHubToken()
    cachedAccount = null
    return {
      state: 'error',
      message:
        error instanceof Error
          ? `Stored GitHub credentials are invalid: ${error.message}`
          : 'Stored GitHub credentials are invalid.'
    }
  }
}

export async function beginGitHubDeviceFlow(): Promise<GitHubStatus> {
  const clientId = getClientId()
  if (!clientId) {
    return setStatus({ state: 'unconfigured' })
  }

  cancelPendingFlow()
  flowGeneration += 1
  const generation = flowGeneration
  const abort = new AbortController()

  const deviceUrl = `${getLoginUrl()}/login/device/code`
  const body = new URLSearchParams({
    client_id: clientId,
    scope: DEVICE_SCOPES
  })

  let device: DeviceCodeResponse
  try {
    device = await fetchJson<DeviceCodeResponse>(deviceUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body,
      signal: abort.signal
    })
  } catch (error) {
    if (isAbortError(error)) {
      return { state: 'disconnected' }
    }
    return setStatus({
      state: 'error',
      message: error instanceof Error ? error.message : 'Failed to start GitHub device flow.'
    })
  }

  if (generation !== flowGeneration) {
    return { state: 'disconnected' }
  }

  const expiresAt = new Date(Date.now() + device.expires_in * 1000).toISOString()
  pendingFlow = {
    generation,
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    expiresAt,
    abort
  }

  void shell.openExternal(device.verification_uri).catch(() => {
    // Headless / CI environments may reject; the user can still open the URI manually.
  })

  const status: GitHubStatus = {
    state: 'pending',
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    expiresAt
  }
  broadcastStatus(status)

  void runDeviceFlow(device.device_code, device.interval, abort, generation)
  return status
}

function cancelPendingFlow(): void {
  if (!pendingFlow) return
  pendingFlow.abort.abort()
  pendingFlow = null
}

export async function cancelGitHubDeviceFlow(): Promise<GitHubStatus> {
  flowGeneration += 1
  cancelPendingFlow()
  cachedAccount = null

  if (!getClientId()) {
    return setStatus({ state: 'unconfigured' })
  }

  const token = readGitHubToken()
  if (token) {
    try {
      const account = await fetchAuthenticatedUser(token)
      cachedAccount = account
      return setStatus({ state: 'connected', account })
    } catch {
      deleteGitHubToken()
    }
  }

  return setStatus({ state: 'disconnected' })
}

export async function disconnectGitHub(): Promise<GitHubStatus> {
  flowGeneration += 1
  cancelPendingFlow()
  cachedAccount = null
  deleteGitHubToken()

  if (!getClientId()) {
    return setStatus({ state: 'unconfigured' })
  }

  return setStatus({ state: 'disconnected' })
}

export function registerGitHubIpc(ipcMain: Electron.IpcMain): void {
  ipcMain.handle(IPC.github.getStatus, async () => {
    try {
      return await getGitHubStatus()
    } catch (error) {
      return {
        state: 'error',
        message: error instanceof Error ? error.message : 'Failed to load GitHub status.'
      } satisfies GitHubStatus
    }
  })

  ipcMain.handle(IPC.github.beginDeviceFlow, async () => {
    try {
      return await beginGitHubDeviceFlow()
    } catch (error) {
      return setStatus({
        state: 'error',
        message: error instanceof Error ? error.message : 'Failed to start GitHub device flow.'
      })
    }
  })

  ipcMain.handle(IPC.github.cancelDeviceFlow, async () => {
    try {
      return await cancelGitHubDeviceFlow()
    } catch (error) {
      return setStatus({
        state: 'error',
        message: error instanceof Error ? error.message : 'Failed to cancel GitHub device flow.'
      })
    }
  })

  ipcMain.handle(IPC.github.disconnect, async () => {
    try {
      return await disconnectGitHub()
    } catch (error) {
      return setStatus({
        state: 'error',
        message: error instanceof Error ? error.message : 'Failed to disconnect GitHub.'
      })
    }
  })
}
