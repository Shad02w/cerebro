import { connectMux, MuxError } from '@cerebro/mux'
import { die, printJson } from '../output'
export async function serverCommand(args: string[]): Promise<void> {
  if (!args.length || args.includes('--help')) {
    process.stdout.write('Usage: cerebro server status|start|stop\n')
    return
  }
  if (args.length !== 1 || !['status', 'start', 'stop'].includes(args[0]))
    die('Usage: cerebro server status|start|stop', 'usage', 2)
  try {
    const client = await connectMux({ autoStart: args[0] === 'start' })
    try {
      if (args[0] === 'stop') {
        let timer: ReturnType<typeof setTimeout>
        const stopped = new Promise<void>((resolve, reject) => {
          timer = setTimeout(
            () => reject(new MuxError('unavailable', 'Mux shutdown timed out.')),
            120000
          )
          client.once('disconnected', () => {
            clearTimeout(timer)
            resolve()
          })
        })
        const result = await client.request('server.stop')
        await stopped
        printJson(result)
      } else printJson(await client.request('server.status'))
    } finally {
      client.close()
    }
  } catch (error) {
    if (args[0] === 'status' && error instanceof MuxError && error.code === 'unavailable') {
      printJson({ running: false })
      return
    }
    die(
      error instanceof Error ? error.message : String(error),
      error instanceof MuxError ? error.code : 'internal'
    )
  }
}
