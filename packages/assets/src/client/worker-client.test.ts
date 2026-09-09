import { describe, expect, it, vi } from 'vitest'
import { AssetWorkerClient } from './worker-client'

describe('asset worker startup failures', () => {
  it('rejects a pending handshake immediately when the worker fails to load', async () => {
    const worker = new EventTarget()
    const port = Object.assign(new EventTarget(), { start: vi.fn(), close: vi.fn(), postMessage: vi.fn() })
    const client = new AssetWorkerClient(Object.assign(worker, { port }) as unknown as SharedWorker, 'test')
    const connection = client.connect()
    const rejection = expect(connection).rejects.toMatchObject({ code: 'ASSET_WORKER_INITIALIZATION_FAILED', message: 'Duplicate identifier h' })
    worker.dispatchEvent(Object.assign(new Event('error'), { message: 'Duplicate identifier h' }))
    await rejection
    client.close()
    expect(port.close).toHaveBeenCalledOnce()
  })
})
