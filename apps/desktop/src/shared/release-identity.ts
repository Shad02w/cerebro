export type ReleaseChannel = 'dev' | 'production'

export function getReleaseIdentity(channel: string): {
  channel: ReleaseChannel
  appId: string
  productName: string
  dataDirectory: string
  cliCommand: string
} {
  if (channel !== 'dev' && channel !== 'production') {
    throw new Error(`Unknown release channel: ${channel}`)
  }
  const development = channel === 'dev'
  return {
    channel,
    appId: development ? 'com.cerebro.app.dev' : 'com.cerebro.app',
    productName: development ? 'Cerebro Dev' : 'Cerebro',
    dataDirectory: development ? 'cerebro-dev' : 'cerebro',
    cliCommand: development ? 'cerebro-dev' : 'cerebro'
  }
}
