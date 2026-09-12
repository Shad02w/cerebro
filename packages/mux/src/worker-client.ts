import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MuxError } from './protocol'
export class StorageWorker {
  readonly worker = new Worker(join(__dirname, 'mux-worker.cjs'))
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private failure?: Error
  onGit?: (operationId: string, args: string[], cwd?: string) => Promise<string>
  constructor() {
    this.worker.on('message', async (message) => {
      if (message.git) {
        try {
          this.worker.postMessage({
            gitReply: message.id,
            result: await this.onGit!(message.operationId, message.args, message.cwd)
          })
        } catch (error) {
          this.worker.postMessage({ gitReply: message.id, error: String(error) })
        }
        return
      }
      const request = this.pending.get(message.id)
      if (!request) return
      this.pending.delete(message.id)
      if (message.error) request.reject(new MuxError(message.error.code, message.error.message))
      else request.resolve(message.result)
    })
    const fail = (error: Error): void => {
      this.failure = error
      for (const request of this.pending.values()) request.reject(error)
      this.pending.clear()
    }
    this.worker.on('error', fail)
    this.worker.on('exit', (code) => fail(new Error(`Storage worker exited (${code}).`)))
  }
  call<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    if (this.failure) return Promise.reject(this.failure)
    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject })
      this.worker.postMessage({ id, method, params })
    })
  }
}
