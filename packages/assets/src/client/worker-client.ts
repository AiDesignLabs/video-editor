/* eslint-disable style/max-statements-per-line */
import type { AssetWorkerHelloAck, AssetWorkerOperation, AssetWorkerResponse, AssetWorkerResult } from '../protocol/messages'
import type { AssetEvent } from '../types'
import { AssetError } from '../errors'

export class AssetWorkerClient {
  private ack?: AssetWorkerHelloAck
  private requestSequence = 0
  private readonly pending = new Map<string, { resolve: (value: unknown) => void, reject: (error: unknown) => void, timeout: ReturnType<typeof setTimeout> }>()
  private readonly listeners = new Set<(event: AssetEvent) => void>()
  private closed = false

  constructor(private readonly worker: SharedWorker, private readonly expectedCacheNamespace: string) {
    worker.port.addEventListener('message', this.onMessage)
    worker.port.start()
  }

  async connect(timeoutMs = 5_000): Promise<AssetWorkerHelloAck> {
    const result = new Promise<AssetWorkerHelloAck>((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete('hello'); reject(new Error('Asset worker handshake timed out.')) }, timeoutMs)
      this.pending.set('hello', { resolve: value => resolve(value as AssetWorkerHelloAck), reject, timeout })
    })
    this.worker.port.postMessage({ type: 'hello', protocolVersion: 1, clientId: crypto.randomUUID(), expectedCacheNamespace: this.expectedCacheNamespace })
    return await result
  }

  async request<T extends AssetWorkerResult>(operation: AssetWorkerOperation, timeoutMs = 30_000): Promise<T> {
    if (!this.ack)
      throw new Error('Asset worker client is not connected.')
    if (this.closed)
      throw new Error('Asset worker client is closed.')
    const requestId = `${++this.requestSequence}`
    const result = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`Asset worker request ${operation.type} timed out.`)) }, timeoutMs)
      this.pending.set(requestId, { resolve: value => resolve(value as T), reject, timeout })
    })
    this.worker.port.postMessage({ type: 'request', requestId, cacheGeneration: this.ack.cacheGeneration, clientSessionToken: this.ack.clientSessionToken, operation })
    const value = await result
    if (operation.type === 'clear-cache')
      this.ack.cacheGeneration++
    return value
  }

  subscribe(listener: (event: AssetEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  close() { this.closed = true; this.worker.port.removeEventListener('message', this.onMessage); this.worker.port.close(); for (const item of this.pending.values()) { clearTimeout(item.timeout); item.reject(new Error('Asset worker client closed.')) }; this.pending.clear() }

  private readonly onMessage = (message: MessageEvent<AssetWorkerResponse>) => {
    if (message.data.type === 'event') { for (const listener of this.listeners) listener(message.data.event); return }
    const pending = this.pending.get(message.data.requestId)
    if (!pending)
      return
    clearTimeout(pending.timeout); this.pending.delete(message.data.requestId)
    if (message.data.type === 'error') { pending.reject(new AssetError(toAssetErrorCode(message.data.code), message.data.message)); return }
    if (message.data.type === 'hello-ack') { this.ack = message.data.ack; pending.resolve(message.data.ack); return }
    pending.resolve(message.data.result)
  }
}

function toAssetErrorCode(code: string): ConstructorParameters<typeof AssetError>[0] {
  const known: ConstructorParameters<typeof AssetError>[0][] = [
    'ASSET_UNAVAILABLE',
    'ASSET_PERSISTENCE_UNAVAILABLE',
    'ASSET_STALE_REVISION',
    'ASSET_IDENTITY_CONFLICT',
    'ASSET_CACHE_QUOTA_EXCEEDED',
    'PROTOCOL_VERSION_MISMATCH',
    'CACHE_NAMESPACE_MISMATCH',
    'ASSET_CACHE_GENERATION_CHANGED',
    'ASSET_CLIENT_SESSION_INVALID',
    'ASSET_WORKER_ERROR',
    'ASSET_WORKER_INITIALIZATION_FAILED',
    'UPLOAD_RESUME_UNAVAILABLE',
    'UPLOAD_ACCESS_DENIED',
    'UPLOAD_ADAPTER_INVALID',
  ]
  return known.includes(code as ConstructorParameters<typeof AssetError>[0]) ? code as ConstructorParameters<typeof AssetError>[0] : 'ASSET_WORKER_ERROR'
}
