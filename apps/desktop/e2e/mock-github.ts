import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export type MockGitHubServer = {
  baseUrl: string
  authorize: (deviceCode?: string) => void
  lastUserCode: () => string | null
  close: () => Promise<void>
}

type PendingDevice = {
  deviceCode: string
  userCode: string
  authorized: boolean
  token: string
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

export async function startMockGitHubServer(): Promise<MockGitHubServer> {
  const devices = new Map<string, PendingDevice>()
  const tokens = new Map<string, string>()
  let counter = 0
  let lastUserCode: string | null = null
  let baseUrl = 'http://127.0.0.1'

  const server: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', baseUrl)
      const method = req.method ?? 'GET'

      if (method === 'POST' && url.pathname === '/login/device/code') {
        await readBody(req)
        counter += 1
        const deviceCode = `device-code-${counter}`
        const userCode = `CODE-${String(counter).padStart(4, '0')}`
        const token = `token-${counter}`
        devices.set(deviceCode, {
          deviceCode,
          userCode,
          authorized: false,
          token
        })
        lastUserCode = userCode
        sendJson(res, 200, {
          device_code: deviceCode,
          user_code: userCode,
          verification_uri: `${baseUrl}/login/device`,
          expires_in: 900,
          interval: 1
        })
        return
      }

      if (method === 'POST' && url.pathname === '/login/oauth/access_token') {
        const body = await readBody(req)
        const form = new URLSearchParams(body)
        const deviceCode = form.get('device_code') ?? ''
        const device = devices.get(deviceCode)
        if (!device) {
          sendJson(res, 200, {
            error: 'incorrect_device_code',
            error_description: 'Unknown device code'
          })
          return
        }
        if (!device.authorized) {
          sendJson(res, 200, {
            error: 'authorization_pending',
            error_description: 'Authorization pending'
          })
          return
        }
        tokens.set(device.token, device.userCode)
        sendJson(res, 200, {
          access_token: device.token,
          token_type: 'bearer',
          scope: 'repo,read:user'
        })
        return
      }

      if (method === 'GET' && url.pathname === '/user') {
        const auth = req.headers.authorization ?? ''
        const token = auth.replace(/^(?:Bearer|token)\s+/i, '').trim()
        if (!token || !tokens.has(token)) {
          sendJson(res, 401, { message: 'Bad credentials' })
          return
        }
        sendJson(res, 200, {
          login: 'octocat',
          name: 'The Octocat',
          // data: URL so CSP (img-src 'self' data: + GitHub hosts) still allows e2e avatars
          avatar_url:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
        })
        return
      }

      if (method === 'GET' && url.pathname === '/avatar.png') {
        const png = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64'
        )
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length })
        res.end(png)
        return
      }

      if (method === 'GET' && url.pathname === '/login/device') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('Mock GitHub device verification page')
        return
      }

      sendJson(res, 404, { message: `Not found: ${method} ${url.pathname}` })
    } catch (error) {
      sendJson(res, 500, {
        message: error instanceof Error ? error.message : 'Mock server error'
      })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind mock GitHub server')
  }

  baseUrl = `http://127.0.0.1:${address.port}`

  return {
    baseUrl,
    authorize: (deviceCode?: string): void => {
      if (deviceCode) {
        const device = devices.get(deviceCode)
        if (device) device.authorized = true
        return
      }
      const latest = [...devices.values()].at(-1)
      if (latest) latest.authorized = true
    },
    lastUserCode: (): string | null => lastUserCode,
    close: async (): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections()
        }
      })
    }
  }
}
