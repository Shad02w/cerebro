export type GitHubCredentials = {
  accessToken: string
  expiresAt?: number
  refreshToken?: string
  refreshExpiresAt?: number
}
export type TokenResponse = {
  access_token: string
  expires_in?: number
  refresh_token?: string
  refresh_token_expires_in?: number
}
export function credentialsFromResponse(response: TokenResponse): GitHubCredentials {
  return {
    accessToken: response.access_token,
    expiresAt: response.expires_in == null ? undefined : Date.now() + response.expires_in * 1000,
    refreshToken: response.refresh_token,
    refreshExpiresAt:
      response.refresh_token_expires_in == null
        ? undefined
        : Date.now() + response.refresh_token_expires_in * 1000
  }
}

/** Rotation is single-flight and may never resurrect credentials after disconnect. */
export class GitHubCredentialManager {
  private refreshing: Promise<string | null> | null = null
  private generation = 0
  constructor(
    private readonly store: {
      read: () => GitHubCredentials | null
      write: (credentials: GitHubCredentials) => void
      refresh: (refreshToken: string) => Promise<TokenResponse>
    }
  ) {}
  reset(): void {
    this.generation++
    this.refreshing = null
  }
  async token(forceRefresh = false): Promise<string | null> {
    if (this.refreshing) return this.refreshing
    const credentials = this.store.read()
    if (!credentials) return null
    if (
      !forceRefresh &&
      (credentials.expiresAt == null || credentials.expiresAt > Date.now() + 60_000)
    )
      return credentials.accessToken
    if (
      !credentials.refreshToken ||
      (credentials.refreshExpiresAt != null && credentials.refreshExpiresAt <= Date.now())
    ) {
      throw new Error('GitHub session expired. Reconnect GitHub to renew access.')
    }
    const generation = this.generation
    const operation = (async (): Promise<string | null> => {
      const response = await this.store.refresh(credentials.refreshToken!)
      if (generation !== this.generation) return null
      if (!response.access_token || !response.refresh_token)
        throw new Error('GitHub could not renew the session. Reconnect GitHub.')
      this.store.write(credentialsFromResponse(response))
      return response.access_token
    })()
    this.refreshing = operation
    try {
      return await operation
    } finally {
      if (this.refreshing === operation) this.refreshing = null
    }
  }
}
