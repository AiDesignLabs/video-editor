export type AssetErrorCode
  = | 'ASSET_UNAVAILABLE'
    | 'ASSET_PERSISTENCE_UNAVAILABLE'
    | 'ASSET_STALE_REVISION'
    | 'ASSET_IDENTITY_CONFLICT'
    | 'ASSET_CACHE_QUOTA_EXCEEDED'
    | 'PROTOCOL_VERSION_MISMATCH'
    | 'CACHE_NAMESPACE_MISMATCH'
    | 'ASSET_CACHE_GENERATION_CHANGED'
    | 'ASSET_CLIENT_SESSION_INVALID'
    | 'ASSET_WORKER_ERROR'
    | 'ASSET_WORKER_INITIALIZATION_FAILED'
    | 'UPLOAD_RESUME_UNAVAILABLE'
    | 'UPLOAD_ACCESS_DENIED'
    | 'UPLOAD_ADAPTER_INVALID'

export class AssetError extends Error {
  constructor(public readonly code: AssetErrorCode, message: string) {
    super(message)
    this.name = 'AssetError'
  }
}
export class AssetUnavailableError extends AssetError {
  constructor(message = 'The asset has no local file or available remote URL.') {
    super('ASSET_UNAVAILABLE', message)
    this.name = 'AssetUnavailableError'
  }
}
export class AssetPersistenceUnavailableError extends AssetError {
  constructor(message = 'Persistent browser asset storage is unavailable.') {
    super('ASSET_PERSISTENCE_UNAVAILABLE', message)
    this.name = 'AssetPersistenceUnavailableError'
  }
}
