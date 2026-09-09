# RFC 0009：前端素材运行时与跨项目缓存

- 状态：已采纳，待实施
- 创建日期：2026-09-03
- 范围：纯前端素材服务、跨标签页协调、OPFS 缓存、IndexedDB 元数据、媒体预处理与上传适配
- 相关文档：[RFC 0005](./0005-stable-asset-identity.md)、
  [RFC 0006](./0006-media-asset-public-api.md)、[RFC 0007](./0007-unified-media-io.md)

## 1. 摘要

新增独立包 `@video-editor/assets`。该包提供纯浏览器端 `AssetService`，统一负责以下能力：

- 以稳定素材身份解析原文件和派生版本。
- 将可重新获取的图片、音频和视频文件缓存在 Origin Private File System（OPFS）中。
- 使用 IndexedDB 保存可查询的素材、派生版本、缓存状态和任务摘要。
- 使用 `SharedWorker` 协调同源、同一前端构建的多个标签页，并用 IndexedDB 租约保证不同 Worker
  runtime 并存时的缓存写入正确性。
- 通过版本化 rendition profile（媒体处理配置）生成必需的兼容播放版本，并在主流程完成后异步生成
  多档优化版本。
- 通过宿主注入的 `UploadPort` 编排直传和可恢复上传，但不包含服务端实现、鉴权规则或云存储 SDK。

OPFS 直接保存文件内容。IndexedDB 不重复保存视频 `Blob`，只保存文件路径、大小、状态、访问时间、
过期时间和身份关系。`SharedWorker` 不是永久后台服务；最后一个标签页关闭后，浏览器可以终止它。
下次画布页面连接时，Worker 恢复状态，并继续执行清理检查和未到期的优化任务。

缓存按浏览器 origin 全局管理，不以账号或项目为单位。只要调用方提供同一份稳定素材引用，不同账号、
项目和标签页都可以命中同一份静态文件。项目删除、关闭、账号切换或退出登录均不直接删除缓存；只有
显式清理缓存或全局回收策略可以删除对应文件。

## 2. 背景

当前 `@video-editor/protocol` 已经具备素材清单、OPFS 文件写入、预览版本、缩略图和波形缓存，
但其实现存在以下边界问题：

1. 素材元数据保存在 OPFS 的单个 `manifest.json` 中，不适合按状态、最近访问时间和过期时间查询。
2. 写入去重只依赖当前 JavaScript 实例内的 `Map`，不同标签页仍可能重复下载或互相清理文件。
3. 资源缓存只有 `add`、`get`、`remove` 和 `clear`，没有容量预算、全局 LRU、配额恢复或孤儿文件清理。
4. 当前 URL 缓存键虽然会移除 query 和 hash，但不能完整表达素材 revision 与具体派生版本。
5. `MediaAssetCatalog` 同时承担逻辑素材管理和物理文件存储，容易把「删除素材」与「回收缓存」混为
   同一个动作。
6. 上传、视频规范化和多档清晰度生成属于宿主业务流程，目前没有可复用的前端编排边界。

## 3. 目标与非目标

### 3.1 目标

- 同一 origin 内跨账号、跨项目、跨标签页复用已经缓存的媒体文件。
- 首次访问时允许立即使用远端 URL，并在后台写入 OPFS；后续访问优先读取 OPFS。
- OPFS、IndexedDB 或 `SharedWorker` 不可用时，远端素材明确进入 `url-only` 模式。
- 统一管理缓存状态、最近访问时间、过期条件、容量预算和清理原因。
- 同一个素材可以同时服务画布、时间轴、审片和导出，不把消费场景写入缓存身份。
- 视频上传只等待原文件和条件性兼容播放版本；其他清晰度按明确的 rendition profile 异步生成。
- 大文件上传可以通过宿主实现的存储无关接口分片，并在页面重新打开后恢复未完成任务。
- 保留 `MediaAssetCatalog` 和 renderer 字符串 resolver 的兼容入口，并增加可释放的 handle resolver，
  允许渐进迁移。

### 3.2 非目标

- 不新增 AssetService 服务端、数据库、队列或云存储实现。
- 不保证标签页全部关闭后继续转码或上传。
- 不把浏览器 OPFS 当作用户唯一的永久媒体库。
- 不在第一版实现跨设备缓存同步或点对点文件传输。
- 不按项目建立独立缓存目录、容量预算或删除规则。
- 不用 Service Worker 拦截全部媒体请求；renderer 仍通过显式 resolver 获取媒体来源。
- 不允许缺少必需的转码能力时静默上传一个无法满足处理要求的文件。

## 4. 模块边界

### 4.1 包结构

```text
packages/assets/
├── src/client/                 # AssetService 与 SharedWorker RPC 客户端
├── src/worker/                 # AssetWorkerRuntime 与消息处理
├── src/media-worker/           # MediaProcessor Dedicated Worker RPC
├── src/storage/
│   ├── asset-record-store.ts   # IndexedDB 素材和派生版本记录
│   ├── cache-entry-store.ts    # IndexedDB 缓存状态与索引
│   ├── job-store.ts            # IndexedDB 任务摘要与恢复
│   ├── upload-job-store.ts     # 可恢复 ingest 父级 checkpoint
│   ├── upload-session-store.ts # 分片上传 session checkpoint
│   └── asset-file-store.ts     # opfs-tools 文件读写
├── src/cache/                  # 下载去重、租约、LRU 与清理策略
├── src/renditions/             # rendition profile 与媒体处理编排
├── src/upload/                 # UploadPort、断点续传与上传工作流
├── src/protocol/               # RPC 请求、响应、事件和错误
└── src/index.ts
```

依赖方向：

```text
@video-editor/protocol -> @video-editor/assets -> @video-editor/media
                                  |
                                  +-> idb、opfs-tools
```

`@video-editor/media` 是无状态媒体计算层，只负责读取媒体、分析、解码、编码和向调用方提供的 sink
写出结果；它不知道 `assetId`、缓存键、OPFS 目录、IndexedDB、上传会话或项目协议。
`@video-editor/assets` 是素材生命周期层，负责决定何时处理、产物身份、存储位置、任务状态、缓存和
上传。只有 `src/renditions` 的 `MediaProcessor` adapter 依赖 `@video-editor/media`；宿主通过
`src/media-worker` 提供的 RPC helper 将其放入独立 Dedicated Worker。只使用解析、缓存或普通文件
上传的调用方不会初始化编解码运行时。依赖始终单向，
`@video-editor/media` 不得反向依赖 `@video-editor/assets`。

`@video-editor/assets` 不依赖 Vue、PixiJS、工程协议或宿主 API。`@video-editor/protocol` 中的
`MediaAssetCatalog` 继续作为协议适配层，负责片段绑定和逻辑素材删除保护。renderer 继续依赖注入
的 resolver，不直接查询 IndexedDB。

### 4.2 运行时职责

| 组件                 | 职责                                                                  | 不负责                 |
| -------------------- | --------------------------------------------------------------------- | ---------------------- |
| `AssetService`       | 标签页内公共入口、对象 URL 生命周期、上传工作流、事件订阅             | 直接实现 OPFS 并发控制 |
| `AssetWorkerClient`  | RPC、握手、超时、取消、断线恢复                                       | 业务上传策略           |
| `AssetWorkerRuntime` | IndexedDB、OPFS、持久写入租约、同键任务去重、缓存租约、清理和状态广播 | DOM、Vue、OSS SDK      |
| `MediaProcessor`     | 延迟调用 `@video-editor/media`，把 profile 转为媒体输入、输出和进度   | 素材身份、缓存和上传   |
| `MediaProcessorWorker` | 在 Dedicated Worker 执行 `MediaProcessor`，转发进度、取消和多档结果 | 缓存 RPC、业务上传     |
| `UploadPort`         | 定义直传及可选断点续传契约；由宿主 adapter 实现                       | 本地缓存和业务写回     |
| `MediaAssetCatalog`  | 协议引用、片段绑定、逻辑素材删除保护                                  | 全局缓存容量管理       |

媒体转码不应占用页面主线程，也不应长期占用负责缓存 RPC 的 `SharedWorker`。宿主使用
`createWorkerMediaProcessor()` 注入 Dedicated Worker 工厂，Worker 入口使用
`attachMediaProcessorWorker()` 执行转码。页面内的 `AssetService` 仍负责任务编排和上传；Dedicated
Worker 只接收 `File + profile`，返回进度和多档 `File` 结果。取消时页面立即结束等待，但 Worker 在
发出终态消息前继续执行 `finally` 清理；超过固定宽限时间仍无响应才强制终止。可选优化使用按
`cacheNamespace` 命名的 Web Lock，将同一 origin 的媒体处理并发限制为 `1`，任务状态只在当前 client
session 中维护。浏览器缺少 Web Locks 时跳过可选优化，不得退化为多个标签页各自转码；兼容版本和
required profile 仍按主任务要求明确成功或失败。

## 5. 能力模式与失败语义

```ts
export interface AssetCapabilities {
  mode: 'shared-cache' | 'url-only'
  sharedWorker: boolean
  indexedDB: boolean
  opfs: boolean
  mediaProcessing: boolean
  persistentStorage: boolean
  resumableUpload: boolean
}
```

- `shared-cache`：`SharedWorker`、IndexedDB 和 OPFS 均可用。允许持久缓存、跨标签页去重和全局清理。
- `url-only`：任一必需缓存能力不可用。远端素材仍返回 URL，但不得写入未被追踪的 OPFS 文件。
- 本地 `File` 在当前标签页中仍可预览或上传，但如果调用方要求跨刷新保存，必须抛出
  `AssetPersistenceUnavailableError`。
- `resumableUpload` 只有在 SharedWorker、IndexedDB、OPFS、宿主 `ResumableUploadPort`、
  `checkResumeAccess()` 和 `restoreUploadedVariant()` 全部可用时为 `true`。普通直传可用不表示能够
  跨刷新恢复。
- URL、OPFS 文件和可刷新远端地址均不存在时，抛出 `AssetUnavailableError`，不得返回空字符串或
  伪造地址。
- `navigator.storage.persist()` 只能由标签页在合适的用户交互后请求。拒绝持久存储不影响功能，
  但 `persistentStorage` 保持 `false`，缓存仍可能被浏览器回收。

能力检测在 `createAssetService()` 初始化时完成，并通过握手返回。不要在每次解析时重复探测。

## 6. 身份模型

### 6.1 稳定引用

```ts
export interface AssetRef {
  assetId: string
  sourceRevision: number
}

export interface AssetVariantRef extends AssetRef {
  variantId: string
}

interface CachedAssetVariantKey extends AssetVariantRef {
  cacheNamespace: string
}
```

- `assetId`：逻辑原始素材的稳定 ID。远端素材优先使用宿主文件 ID，本地素材使用 `crypto.randomUUID()`。
- `sourceRevision`：原始内容的版本。重新关联到不同内容时递增；签名 URL 轮换不递增。
- `variantId`：一份具体原文件或派生文件的稳定 ID。原文件使用 `source`；远端派生文件优先使用
  其文件 ID；尚未登记的本地产物使用 UUID。

`AssetVariantRef` 可以写入项目协议，但不包含账号或项目作用域。`cacheNamespace` 只区分同一 origin
下的应用或环境，例如 `creatly-media-prod-cn`；它不能包含账号、项目或每次发布变化的 build ID，也
不写入项目协议、审片版本或协作消息。Worker runtime 创建时配置它，是唯一事实来源；
标签页只声明预期值并在握手时校验，不能自行选择存储作用域。

宿主必须保证 `assetId + sourceRevision + variantId` 在一个 `cacheNamespace` 内全局唯一。若后端文件 ID
只在账号内唯一，就不能直接去掉账号字段：宿主必须先提供全局文件 ID，或提供可信内容摘要并使用
内容寻址对象层。身份冲突且内容摘要不一致时返回 `ASSET_IDENTITY_CONFLICT`，不得复用已有字节。

派生文件另外记录版本化 `profileId`，例如 `editing-avc-aac-h720-v1`。`profileId` 表示生成配方，
用于查找可复用派生文件；`variantId` 表示已经生成的具体文件。重新生成同一配方时必须产生新的
`variantId`，旧文件随后进入可清理状态。

### 6.2 缓存键

IndexedDB 使用 `cacheNamespace` 与结构化引用组成复合键。OPFS 文件名使用以下规范数组 JSON 的
SHA-256 十六进制值：

```text
JSON.stringify(['v1', cacheNamespace, assetId, sourceRevision, variantId])
```

SHA-256 的作用是生成长度固定、适合作为文件名的物理键，不用于判断两个视频内容是否相同。
不使用 MD5 作为缓存主键，原因如下：

1. MD5 在本方案中只适合兼容宿主已有的秒传协议，不是可靠的业务身份。
2. 为远端大视频计算完整 MD5 会增加一次全量读取，首次播放反而更慢。
3. 同一个素材的签名 URL 可以变化，但 `assetId`、revision 和 `variantId` 不应变化。
4. 同一个 URL 偶尔发生原地内容替换时，由宿主递增 `sourceRevision` 或提供新的 `variantId`。

`contentDigest` 可以作为可选完整性字段保存，例如宿主已经计算出的 MD5 或 SHA-256，但不参与默认
逻辑缓存身份。未来若要让不同文件 ID 共享相同字节，应单独增加以可信 SHA-256 为键的物理对象层；
这与当前按稳定引用去重是两个问题，不能直接用 MD5 替换引用键。

### 6.3 不保存 `purpose`

缓存记录和缓存键不包含 `purpose: 'canvas' | 'timeline' | 'review' | 'export'`。这些值描述消费者，
不描述文件。一个 720P H.264/AAC 文件可以同时供画布、时间轴和审片使用；把场景写入身份会复制
相同文件，并使跨项目回收更复杂。

调用方通过明确的 `variantId` 或 `profileId` 选择文件。不同场景确实需要不同编码参数时，使用不同
版本化 profile，不新增模糊的用途字段。

## 7. IndexedDB 数据模型

数据库名为 `video-editor-assets`，第一版 schema version 为 `1`。时间统一保存 Unix 毫秒时间戳。
使用 `idb` 的 `DBSchema` 声明以下 object store：

### 7.1 `assetRecords`

主键：`[cacheNamespace, assetId]`。

```ts
export interface AssetRecord extends AssetRef {
  kind: 'video' | 'audio' | 'image' | 'other'
  name?: string
  createdAt: number
  updatedAt: number
}

interface StoredAssetRecord extends AssetRecord {
  cacheNamespace: string
}
```

索引：`byNamespaceUpdatedAt = [cacheNamespace, updatedAt]`。

### 7.2 `variantRecords`

主键：`[cacheNamespace, assetId, sourceRevision, variantId]`。

```ts
export interface AssetVariantRecord extends AssetVariantRef {
  profileId?: string
  remoteFileId?: string
  remoteRecovery: 'host-refreshable' | 'none'
  contentType?: string
  sizeBytes?: number
  width?: number
  height?: number
  durationMs?: number
  contentDigest?: { algorithm: 'md5' | 'sha-256', value: string }
  createdAt: number
  updatedAt: number
}

interface StoredAssetVariantRecord extends AssetVariantRecord {
  cacheNamespace: string
}
```

索引：`byAssetRevision = [cacheNamespace, assetId, sourceRevision]`、
`byProfile = [cacheNamespace, assetId, sourceRevision, profileId]`。`remoteRecovery` 是缓存回收依据：
`host-refreshable` 表示宿主以后可凭稳定引用重新取得 URL，`none` 表示本地唯一字节，不能进入 LRU。
带鉴权信息的远端 URL 和过期时间不写入共享 IndexedDB；每次解析由当前已授权业务状态提供 URL，
必要时由标签页调用宿主刷新回调。

同一 revision 和 profile 存在多份文件时，选择 `createdAt` 最新且仍有本地或远端来源的记录；
`variantId` 用作时间相同情况下的稳定排序。较旧记录只进入回收候选，不自动删除逻辑记录。
`upsertAsset()` 在同一个读写事务中比较现有 revision：相同 revision 合并字段，更高 revision 前进，
更低 revision 返回 `ASSET_STALE_REVISION`，不得让晚到响应覆盖新内容。

### 7.3 `cacheEntries`

主键：`cacheKey`。

```ts
export type AssetCacheStatus = 'downloading' | 'writing' | 'ready' | 'failed'

interface AssetCacheEntry extends CachedAssetVariantKey {
  cacheKey: string
  opfsPath: string
  status: AssetCacheStatus
  /** Monotonic fencing value for writers from one or more Worker runtimes. */
  writerEpoch: number
  writerTokenHash?: string
  writerLeaseUntil?: number
  /** Conservative cross-runtime protection; individual lease IDs remain in memory. */
  leaseProtectionUntil?: number
  sizeBytes?: number
  retryCount: number
  createdAt: number
  updatedAt: number
  lastAccessAt: number
  evictAfter: number
  failureCode?: string
}
```

索引：`byRef`、`byStatusUpdatedAt`、`byLastAccessAt`、`byEvictAfter`。不存在记录表示从未缓存或已经
回收，不额外保存 `missing` 状态。

`evictAfter` 表示可以参加容量回收的最早时间，不表示到点立即删除。`writerEpoch`、token 和短租约用于
不同 SharedWorker runtime 之间的 compare-and-set（比较后写入）；只有当前 owner 可以提交正式文件和
`ready` 状态。每次成功解析只更新内存中的访问时间；同一个条目最多每分钟写回一次，避免播放期间频繁
写 IndexedDB。

### 7.4 `jobs`

```ts
export type AssetJobKind = 'cache' | 'derivation' | 'upload'
export type AssetJobStatus
  = 'queued'
    | 'running'
    | 'paused'
    | 'succeeded'
    | 'succeeded-with-errors'
    | 'failed'
    | 'cancelled'
    | 'interrupted'

export interface AssetJobRecord {
  cacheNamespace: string
  jobId: string
  kind: AssetJobKind
  dedupeKey: string
  status: AssetJobStatus
  phase?: string
  progress?: number
  errorCode?: string
  profileStatuses?: readonly {
    profileId: string
    status: 'queued' | 'processing' | 'uploading' | 'ready' | 'failed' | 'cancelled'
    attemptCount: number
    errorCode?: string
  }[]
  createdAt: number
  updatedAt: number
  expiresAt?: number
}
```

任务记录只保存摘要，不保存 `File`、回调、访问令牌或云存储临时凭证。Worker 启动时把遗留的
`queued` 和 `running` 任务改为 `interrupted`。缓存任务可以在下次访问时重新开始；可恢复上传等待
标签页重新提供业务 context 后继续，派生任务仍按需重启。终态任务默认保留 7 天供诊断，并限制为整个
缓存命名空间最近 1,000 条；超过期限或上限时从最旧记录开始删除。

### 7.5 `uploadJobs`

`jobs` 只用于通用状态和诊断；可跨刷新恢复的完整 ingest 流程另存父级 checkpoint：

```ts
export interface PersistedUploadedVariant {
  remoteFileId: string
  profileId?: string
  storageLocation?: string
  contentType?: string
  sizeBytes?: number
  width?: number
  height?: number
  durationMs?: number
  contentDigest?: { algorithm: 'md5' | 'sha-256', value: string }
}

export interface UploadJobVariantCheckpoint {
  profileId: string
  mode: 'compatibility' | 'optimization'
  status: 'planned' | 'processing' | 'uploading' | 'completed' | 'failed' | 'cancelled'
  attemptCount: number
  uploadId?: string
  uploaded?: PersistedUploadedVariant
  errorCode?: string
}

export interface UploadJobCheckpoint {
  cacheNamespace: string
  jobId: string
  adapterId: string
  checkpointVersion: number
  accessRef: string
  /** Opaque host reference used to continue the correct node or review operation. */
  continuationRef: string
  /** Monotonic compare-and-set version for the current page owner. */
  ownerEpoch: number
  /** SHA-256 of the current random claim token; the raw token is never persisted. */
  claimTokenHash?: string
  ownerLeaseUntil?: number
  policy: AssetIngestPolicy
  businessStatus:
    | 'preparing'
    | 'staging-source'
    | 'uploading-source'
    | 'processing-compatibility'
    | 'uploading-compatibility'
    | 'awaiting-business-commit'
    | 'committed'
    | 'paused'
    | 'failed'
    | 'cancelled'
  optimizationStatus:
    | 'not-planned'
    | 'queued'
    | 'running'
    | 'paused'
    | 'succeeded'
    | 'succeeded-with-errors'
    | 'cancelled'
  optimizationJobId?: string
  businessCommittedAt?: number
  sourceStaging?: {
    opfsPath: string
    status: 'writing' | 'ready'
  }
  sourceName: string
  sourceSizeBytes: number
  sourceDigest?: { algorithm: 'md5' | 'sha-256', value: string }
  sourceMetadata: {
    contentType: string
    width?: number
    height?: number
    durationMs?: number
  }
  sourceUploadId?: string
  source?: PersistedUploadedVariant
  variants: readonly UploadJobVariantCheckpoint[]
  result?: PersistedUploadedAssetResult
  createdAt: number
  updatedAt: number
  retainUntil: number
}

export interface PersistedUploadedAssetResult {
  status: 'ready'
  source: PersistedUploadedVariant
  /** Source when it is browser-playable; otherwise the completed compatibility rendition. */
  playback: PersistedUploadedVariant
  availableVariants: readonly PersistedUploadedVariant[]
  optimizationJobId?: string
}
```

主键为 `[cacheNamespace, jobId]`。父记录同样保存并校验 `adapterId` 与 `checkpointVersion`；即使 child
session 已经删除，秒传、转码和待业务确认阶段也不能让新 adapter 猜测旧数据。policy 必须是只含数据
的不可变快照，不得包含函数。持久结果不保存签名 URL；恢复时以 source 结果、待处理 profile 和各
variant 状态重建剩余流程。中断在转码阶段时，
从保留的 source staging 或缓存文件重新开始该次转码，不尝试恢复编码器内部状态。
父任务的 `retainUntil` 默认固定为 `createdAt + 7 天`，重试和页面重开不延长，避免长期占用磁盘。
`result` 只在 source 和条件性兼容版本上传完成后写入，并将 `businessStatus` 改为
`awaiting-business-commit`；它不包含 URL。业务写入确认前保留该父 checkpoint，使页面重开后仍能
重新取得结果并重试节点或审片写入。业务确认把 `businessStatus` 改为 `committed` 并写入
`businessCommittedAt`；优化仍在运行，或处于允许
显式重试的 `succeeded-with-errors` 时，父 checkpoint 和可重读 source 继续保留。只有业务已经确认且优化
状态为 `succeeded` 或 `cancelled`，或者达到固定期限后，才清理不再需要的数据。

### 7.6 `uploadSessions`

断点续传 checkpoint 与普通任务摘要分开保存，主键为 `[cacheNamespace, uploadId]`，并以
`[cacheNamespace, jobId]` 建立父任务索引。一项素材上传可以包含原文件和多个 rendition，因此一个
`jobId` 可以对应多个上传 session：

```ts
export interface UploadedPartCheckpoint {
  partNumber: number
  sizeBytes: number
  /** Opaque receipt returned by the host adapter, such as a provider part tag. */
  receipt: string
}

export interface UploadSessionRecord {
  cacheNamespace: string
  uploadId: string
  jobId: string
  adapterId: string
  checkpointVersion: number
  relation:
    | { kind: 'source' }
    | { kind: 'variant', sourceRemoteFileId: string, profileId: string }
  resumeToken?: string
  payloadOpfsPath: string
  payloadName: string
  payloadSizeBytes: number
  payloadDigest?: { algorithm: 'md5' | 'sha-256', value: string }
  metadata: {
    contentType: string
    width?: number
    height?: number
    durationMs?: number
  }
  partSizeBytes?: number
  completedParts: readonly UploadedPartCheckpoint[]
  status: 'staging' | 'preparing' | 'uploading' | 'paused' | 'completing' | 'completed' | 'expired' | 'failed'
  createdAt: number
  updatedAt: number
  remoteExpiresAt?: number
  retainUntil: number
}
```

`resumeToken` 和 `receipt` 是宿主 adapter 返回的可持久化不透明值，不能包含访问令牌、临时密钥、
请求头或其他凭证。每个分片得到远端确认后，先用短事务更新 checkpoint，再调度下一批分片。恢复时
以 adapter 查询到的远端分片为准，与本地 checkpoint 合并后只上传缺失部分。

每个 session 的 `retainUntil` 与父任务一致；`remoteExpiresAt` 只描述远端会话。远端提前过期时把 child
标为 `expired`，只要父任务和 staging 仍有效，页面可以生成新 `uploadId`、重新 `prepare()` 并创建替代
session；不能复用旧 id。父任务
到期时在一个短事务中级联删除其 session 记录，随后删除全部 `.partial` 和 `.bin`；Worker 没有当前
context，因此远端 abort 只在用户主动放弃时由页面 best-effort 执行。

### 7.7 `settings`

保存清理策略版本、最后一次完整扫描时间、可选统计，以及 `cacheNamespace` 单调递增的
`cacheGeneration`。单个 `leaseId` 只保存在创建它的 Worker 内存中；`cacheEntries.leaseProtectionUntil`
保存所有 runtime 都必须遵守的保守保护期限，避免滚动发布中的另一个 Worker 清理正在播放的文件。

### 7.8 事务边界

IndexedDB 事务必须短小。不得在同一个事务中等待 `fetch()`、转码、上传或 OPFS I/O；这些等待会
让 IndexedDB 事务自动关闭。正确顺序是：

1. 用短事务写入 `downloading` 或任务 `running`。
2. 在事务外下载或处理文件。
3. 用 OPFS 临时文件完成写入和移动。
4. 用另一个短事务提交 `ready` 或 `failed`。

## 8. OPFS 文件布局

继续使用现有 `opfs-tools`。它操作的对象就是 OPFS 目录和文件，视频、音频、图片及派生媒体的
字节内容直接保存在这些文件中。

```text
/video-editor-assets/v1/
├── objects/<cacheKey[0..1]>/<cacheKey>.bin
├── temp/<jobId>/<outputId>.partial
└── upload-staging/
    ├── jobs/<jobId>/
    │   ├── source.partial
    │   └── source.bin
    └── sessions/<uploadId>/
        ├── payload.partial
        └── payload.bin
```

- 扩展名不参与读取判断，真实媒体类型来自 `variantRecords.contentType`。
- 一个任务的每个下载或 rendition 输出使用独立 `outputId`。写入 `temp`、关闭 writer 并核对大小后，
  再移动到 `objects`，因此并行生成多档清晰度不会覆盖临时文件。
- `.bin` 路径取得的原始 `File.type` 可能为空。返回给页面前以 `variantRecords.contentType` 和逻辑
  文件名创建同一字节内容的 `File` 包装，不能依赖 OPFS 文件扩展名推断 MIME。
- IndexedDB 变为元数据 source of truth，不再在 OPFS 中维护第二份 `manifest.json`。
- `ready` 记录必须对应存在且大小一致的文件。文件缺失时删除该缓存记录，并按 URL 回退。
- 没有对应 `cacheEntries` 的 `objects` 文件是孤儿文件。完整扫描时删除超过 1 小时的孤儿文件。
- `temp` 中超过 1 小时的文件视为中断产物，可直接删除。
- 没有对应 `uploadSessions` 或 `uploadJobs` 的 `upload-staging` 目录超过 1 小时后删除。source session
  指向的文件缺失且父 source 或正式缓存中也没有可重读副本时，父任务不可恢复；rendition payload
  缺失但父 source 仍为 ready 时，只删除该 child 并把对应 profile 重置为 `planned`，下次从 source
  重新生成。
- `upload-staging` 保存需要跨刷新续传的待上传文件，不属于静态缓存 LRU。单个文件上传成功后，只有
  父 ingest 不再需要其字节时才删除或移入缓存；原文件必须保留到兼容版本和已排队优化版本处理完成。
  业务绑定确认本身不能提前删除仍被优化任务使用的 source。staging
  跟随父任务的 `retainUntil`，不跟随单个远端 session 的过期时间。远端 session 过期只废弃该 child，
  有效父任务可以基于同一 staging 重新创建 session。若 policy 要求断点续传但预估空间不足，在开始
  远端上传前抛出 `UPLOAD_STAGING_QUOTA_EXCEEDED`，不得悄悄退化成不可恢复上传。
- source 复制前先创建父级 `uploadJobs`，再流式写 `jobs/<jobId>/source.partial`，关闭并核对大小后移动
  为 `source.bin`，最后用一个短 IndexedDB 事务把 `sourceStaging.status` 改为 `ready`。OPFS 移动与
  IndexedDB 不能组成
  一个原子事务；若中断发生在移动后、状态提交前，启动扫描核对路径、大小和可选摘要后补交 `ready`。
  只有两步都完成后才开始承诺跨刷新恢复并启动远端传输；若只存在 `.partial`，启动扫描删除它、把任务
  标记为 `UPLOAD_STAGING_INTERRUPTED` 且不列入可恢复任务。每个 rendition 上传同样先创建
  `status = staging` 的 session，再写自己的
  `sessions/<uploadId>/payload.partial` 和 `payload.bin`。恢复扫描可以据此清理中断副本，或修复已经
  移动但尚未提交状态的记录；远端分片在对应 staging 完成前不会开始。
- 父 ingest 不再需要原文件字节后，`cacheSource = true` 时把 staging 文件原子移动到 `objects`，否则
  删除；`cacheSource` 只决定最终归宿，不能让仍待兼容处理、后台优化或可恢复重试的 source 提前消失。

## 9. 解析与缓存流程

### 9.1 解析顺序

```text
调用方给出 AssetVariantRef 和当前 URL
              │
              ▼
      查询 ready cache entry
       │                  │
  文件存在且有效       缺失、损坏或不可用
       │                  │
       ▼                  ▼
返回 OPFS File       标记缓存失效并返回 URL
和短期 lease          同时按策略启动后台缓存
```

具体规则：

1. `ready` 且 OPFS 文件存在时，返回 `File` 和 `leaseId`。
2. 标签页为该 `File` 创建 `blob:` URL。`blob:` URL 只存在于标签页内，不写入协议或 IndexedDB。
3. 调用方释放句柄时，撤销对象 URL 并发送 `release(leaseId)`。
4. 缓存记录存在但文件缺失、大小不符或读取失败时，删除记录并返回当前 URL。
5. 当前 URL 缺失或已经过期时，调用宿主的 `refreshRemoteVariant()`；刷新失败且本地也不存在时，
   抛出 `AssetUnavailableError`。
6. URL query 或签名变化只更新远端地址，不改变缓存键。
7. `sourceRevision` 或 `variantId` 变化时使用新缓存键；旧条目进入全局 LRU 候选集。

当前 URL 可以随单次 `resolve` 或 `ensureCached` RPC 瞬时传给 SharedWorker，由 Worker 完成唯一下载和
流式 OPFS 写入；Worker 不把 URL 写入 IndexedDB、日志或广播事件。需要自定义鉴权请求头的下载不把
请求头传给 Worker，应由宿主先换取可直接读取的短期 URL。

### 9.2 缓存写入

同一 `cacheKey` 同时只能有一个有效所有者：

1. SharedWorker 用内存中的 `inflightByCacheKey` 合并同一 runtime 内的请求。
2. runtime 还必须在 IndexedDB 短事务中领取 `writerEpoch + writerToken + writerLeaseUntil`。存在未过期
   owner 时只订阅或等待，租约到期后才能递增 epoch 抢占；该持久租约是跨 runtime 的正确性边界。
3. 下载响应流直接写入 owner 唯一的 OPFS 临时文件，不先收集为完整 `Blob`。
4. 移动正式文件并提交 `ready` 前，在短事务中同时比较 `cacheGeneration`、epoch 和 token。旧 runtime
   的晚到提交被拒绝，并且只能删除自己的临时文件。
5. 失败时由当前 owner 删除临时文件并提交 `failed`；等待方随后可以重新认领。
6. `QuotaExceededError` 触发一次紧急清理和一次重试。第二次仍失败时保留 URL 回退并报告
   `ASSET_CACHE_QUOTA_EXCEEDED`。

## 10. SharedWorker 协议与生命周期

### 10.1 连接

每个客户端先发送以下握手：

```ts
interface AssetWorkerHello {
  type: 'hello'
  protocolVersion: 1
  clientId: string
  expectedCacheNamespace: string
}

interface AssetWorkerHelloAck {
  protocolVersion: 1
  cacheNamespace: string
  cacheGeneration: number
  runtimeInstanceId: string
  workerBuildId: string
  clientSessionToken: string
}
```

Worker 返回能力、数据库版本、策略版本、当前 runtime 实例 ID 和 Worker build ID。协议主版本不兼容时
返回 `PROTOCOL_VERSION_MISMATCH`，客户端进入 `url-only`，不得让两个不兼容运行时同时修改 OPFS。
Worker 返回 runtime 固定的 `cacheNamespace`；与客户端预期值不一致时返回
`CACHE_NAMESPACE_MISMATCH`，不打开存储。握手还返回当前 `cacheGeneration` 和随机
`clientSessionToken`；后续缓存写请求必须携带二者。

### 10.2 Worker 工厂

包提供 Worker runtime 和 RPC 处理器，但不规定宿主的构建工具或发布 URL。宿主负责把
`createAssetWorkerRuntime({ cacheNamespace })` 作为 SharedWorker 入口打包，并向
`createAssetService()` 注入 `createSharedWorker()`。例如 Vite 宿主可以使用
`?sharedworker&inline` 导入构造器；核心包自身不包含该查询语法。

多个标签页只有在 SharedWorker 脚本 URL、name、origin 和 storage key 都相同时才会连接到同一个实例。
Vite 7 的生产 inline SharedWorker 使用由 bundle 字节生成的确定性 `data:` URL，因此同一构建、同一
name 的标签页可以共享实例；Worker 内容变化后 URL 也会变化，滚动发布中的新旧页面可能同时运行两个
runtime。SharedWorker 内存去重只是同一 bundle 内的优化，正确性必须依赖 9.2 节的 IndexedDB 写入租约、
epoch/token fencing 和 `cacheGeneration`，不能依赖全局只有一个 Worker。

宿主必须确保生产 CSP 允许实际 Worker URL。使用 Vite inline 时仅在 `worker-src` 中允许 `data:`，不能
为了该能力放宽 `script-src`。Worker 创建或握手失败时进入明确的 `url-only` 模式。

### 10.3 租约

- 每次返回 OPFS 文件时创建 `leaseId`，防止播放中的文件被清理。
- 客户端每 30 秒续租；runtime 同时把该条目的 `leaseProtectionUntil` 以短事务推进到 90 秒后。
- `pagehide`、组件卸载或主动切换素材时立即释放内存租约。持久保护期限不提前缩短，最多额外保留
  90 秒，以免另一个 runtime 的租约被误清除。
- 清理跳过本 runtime 的有效租约以及尚未到期的持久保护期限，不根据某个项目是否打开决定保留。

### 10.4 清理运行时机

SharedWorker 只在至少一个页面连接期间工作。清理在以下时机执行：

- Worker 初始化且距离上次完整扫描超过 6 小时。
- 有页面连接后每 30 分钟执行一次轻量检查。
- 成功写入大文件后发现缓存超过预算。
- 收到 `QuotaExceededError` 后立即执行紧急清理。
- 用户从设置中显式选择清理缓存。

### 10.5 显式缓存清理

`clearCache()` 必须与所有标签页中的晚到缓存写入串行化：

1. 在 IndexedDB 短事务中递增 `cacheNamespace` 的 `cacheGeneration`，使旧缓存写请求失效。
2. 广播 `cache-clearing`，拒绝旧 generation 的新下载和缓存提交，并取消对应缓存 writer。
3. 等待已经取得的 writer 关闭，删除没有有效租约且可重新获取的 `objects` 文件和 `cacheEntries`，
   保留逻辑素材记录；有租约条目标记为待清理，释放后由下一次 sweep 删除。
4. 返回完成并让仍连接的标签页重新握手。
5. 每次移动缓存临时文件或提交 `ready` 前再次比较 generation。旧任务只能删除自己的临时文件，不能
   在清理后重新创建正式缓存文件或记录。

`clearCache()` 不取消上传或转码，不删除 `uploadJobs`、`uploadSessions` 和 `upload-staging`。上传任务
可以继续远端操作，但旧 generation 的任务不能在清理后自动把产物写回静态缓存。退出登录或切换账号
只关闭当前客户端并释放对象 URL，不触发 `clearCache()`。

### 10.6 上传任务所有权

宿主上传 port 是标签页内的函数，不能传入 SharedWorker。SharedWorker 只维护每个 `jobId` 的执行
所有权、持久 `ownerEpoch`、claim token、checkpoint 和状态广播；取得所有权的标签页执行实际网络
请求，其他标签页只订阅进度。

`MessagePort` 没有可靠的标签页关闭事件，因此所有权使用短租约，不能依赖 `beforeunload`。owner 每
15 秒发送 heartbeat，把 `ownerLeaseUntil` 更新为当前时间后 45 秒；heartbeat 不延长父任务的
`retainUntil`。租约到期后 Worker 才把任务视为 `paused`，新页面重新提供当前业务 context 后可以领取。
Worker 在短事务中递增 `ownerEpoch`，生成随机 `claimToken`，只持久化其 SHA-256；原始 token 仅返回新
owner。所有 checkpoint commit 都携带 `ownerEpoch + claimToken`；Worker 在打开 IndexedDB 事务前计算
token 的 SHA-256，再在同一写事务中比较租约、epoch 和 token hash 后更新，拒绝旧 owner 的晚到结果。
Worker 重启后也从持久 epoch 继续，不能归零。
冻结的旧页面恢复后不能续租旧 epoch；其晚到远端分片通过 adapter 的幂等性和下一次 inspect 收敛。
claim token 不写日志或广播。用户主动取消才调用远端 `abortSession()` 并删除 staging 文件。

## 11. 全局缓存回收策略

### 11.1 默认预算

```text
hasKnownQuota = Number.isFinite(originQuota) && originQuota > 0
hasKnownUsage = Number.isFinite(originUsage) && originUsage >= 0
cacheBudget = hasKnownQuota ? min(5 GiB, originQuota * 40%) : 1 GiB
highWaterMark = cacheBudget * 90%
lowWaterMark = cacheBudget * 70%
originPressure = hasKnownQuota && hasKnownUsage && originUsage / originQuota >= 80%
```

`originUsage` 包含该 origin 的其他 IndexedDB、Cache Storage 和 OPFS 数据，因此清理同时检查
AssetService 自己统计的 `ready` 文件总大小和 `navigator.storage.estimate()` 返回的 origin 使用量。
`usage` 或 `quota` 缺失、为 0 或不是有限数时，不计算 origin 压力，但已跟踪文件仍受 1 GiB 固定
预算约束。这些默认值可由宿主配置，但所有标签页必须通过 Worker 使用同一份策略。

### 11.2 默认过期条件

| 条目                         | `evictAfter` 默认值    | 说明                               |
| ---------------------------- | ---------------------- | ---------------------------------- |
| 可重新下载的原文件           | `lastAccessAt + 30 天` | 过期后进入候选集，不立即删除       |
| 可重新生成或下载的 rendition | `lastAccessAt + 14 天` | 先于原文件回收                     |
| 缩略图、波形等轻量派生文件   | `lastAccessAt + 7 天`  | 迁入统一缓存策略                   |
| 失败记录和普通临时产物       | `updatedAt + 1 小时`   | 恢复扫描时清理，不包含上传 staging |

本地唯一文件使用 `remoteRecovery = 'none'`，不得回收。上传完成并确认宿主以后可按稳定引用刷新 URL
后改为 `host-refreshable`，才转为普通可回收缓存。逻辑素材删除仍由 `MediaAssetCatalog.remove()`
执行引用保护；缓存回收不会删除
`assetRecords` 或工程协议。

### 11.3 候选顺序

达到高水位、origin 压力阈值或发生配额错误时，按以下顺序删除，直到低水位或没有可删除条目：

1. 失败记录、超时临时文件和孤儿文件。
2. 已被新 source revision 或新 variant 替代的条目。
3. 已超过 `evictAfter` 的 rendition，按 `lastAccessAt` 从旧到新。
4. 已超过 `evictAfter` 的可重新下载原文件，按 `lastAccessAt` 从旧到新。
5. 未过期但可重新获取的条目，按全局 LRU 从旧到新。

任何有效租约、正在写入的文件、未到期上传 staging 和 `remoteRecovery = 'none'` 的本地唯一文件均
不得作为静态
缓存 LRU 候选。删除顺序不读取 `accountId` 或 `projectId`。开始可恢复上传前先清理可重新获取的静态
缓存并预估 staging 空间；空间仍不足时明确失败，不能删除活动上传源文件。

## 12. Rendition 与上传

### 12.1 Rendition profile

```ts
export interface VideoRenditionProfile {
  id: string
  container: 'mp4'
  videoCodec: 'avc'
  audioCodec: 'aac'
  maxShortSide: number
  videoBitrate: number
  audioBitrate: number
  keyFrameIntervalMs: number
}
```

profile ID 必须包含配方版本。修改编码器、码率、关键帧间隔或尺寸算法时增加版本，不复用旧 ID。
同一输入的多个档位继续使用 `@video-editor/media` 的一次解码、多路编码能力。

处理策略只声明具体要求：

```ts
export interface AssetIngestPolicy {
  /** Generated only when the source cannot satisfy the required playback contract. */
  compatibilityProfileId?: string
  /** Exact profiles that must be available before the business-ready result. */
  requiredProfileIds?: readonly string[]
  /** Finite best-effort profiles generated after the business-ready result. */
  optimizationProfileIds?: readonly string[]
  /** Includes the first attempt; must be a finite integer greater than or equal to 1. */
  maxOptimizationAttemptsPerProfile: number
  cacheSource: boolean
  cacheProducedVariants: boolean
}

export interface UploadAssetRequestBase<TContext = unknown> {
  file: File
  policy: AssetIngestPolicy
  context: TContext
}

export type UploadAssetRequest<TContext = unknown> = UploadAssetRequestBase<TContext> & (
  | {
    /** Require OPFS staging and an IndexedDB checkpoint before network upload starts. */
    resumeAcrossReloads: true
    /** Non-sensitive host reference for routing a restored result to its business target. */
    continuationRef: string
  }
  | {
    resumeAcrossReloads?: false
    continuationRef?: string
  }
)
```

核心包不提供 `canvas`、`review` 或 `export` 场景枚举。宿主业务模块可以为不同入口组合 policy，
但缓存仍按实际文件身份共享。视频预检后，如果 source 可直接在目标浏览器播放，`playback` 就是 source，
`compatibilityProfileId` 不执行；如果 source 不可播放，该 profile 是唯一阻塞业务绑定的派生版本。
`requiredProfileIds` 表示宿主业务在写入前必须具备的精确清晰度，任一档生成或上传失败都会使主任务失败；
审片可以用它定义发布门禁。`optimizationProfileIds` 只表示期望的额外清晰度，不改变主任务成功条件。
同一 profile 同时出现在 required 和 optimization 集合时按 required 处理，不重复生成。

优化任务必须受控：每个素材只排一个多输出处理任务，一次解码生成本轮缺少的全部 profile，再逐档
串行上传；只有失败档进入下一次处理。每个 profile 的自动尝试上限由
`maxOptimizationAttemptsPerProfile` 明确给出，建议默认值为 `2`，即首次执行加一次自动重试。可选优化
通过 origin 级 Web Lock 保证同一时间只有一个媒体处理任务；交互上传或播放准备任务不进入该后台队列。
最后一个页面关闭时任务暂停，下次页面连接后
可以从未到期的 source staging 或缓存继续。达到固定 `retainUntil`、空间不足或用户取消时停止，不无限
重试。没有可持久化 source 的优化任务只在当前 client session 执行；页面关闭后标记 `interrupted`，
不能伪装成可恢复。宿主可以按文件大小决定是否设置 `resumeAcrossReloads`；显式设为 `true` 时，缺少
持久化能力或可恢复上传 port 必须尽早失败。

### 12.2 UploadPort 与宿主 adapter

```ts
export interface UploadVariantRequest<TContext = unknown> {
  file: File
  /** Stable logical name used again when a checkpoint is resumed. */
  fileName: string
  resumeAcrossReloads: boolean
  /** Reuse a digest already saved in the parent or session checkpoint. */
  knownContentDigest?: { algorithm: 'md5' | 'sha-256', value: string }
  relation:
    | { kind: 'source' }
    | { kind: 'variant', sourceRemoteFileId: string, profileId: string }
  metadata: {
    contentType: string
    sizeBytes: number
    width?: number
    height?: number
    durationMs?: number
  }
  context: TContext
  signal: AbortSignal
  onProgress: (ratio: number | null) => void
}

export interface RemoteVariantDescriptor {
  remoteFileId: string
  profileId?: string
  url: string
  /** Optional provider-neutral location needed by the host business API. */
  storageLocation?: string
  urlExpiresAt?: number
  contentType?: string
  sizeBytes?: number
  width?: number
  height?: number
  durationMs?: number
  contentDigest?: { algorithm: 'md5' | 'sha-256', value: string }
}

export interface UploadedVariant extends RemoteVariantDescriptor {
  /** Present on a source upload or dedup hit when the host can list its derivatives. */
  existingVariants?: readonly RemoteVariantDescriptor[]
}

export type UploadPreparation<TPrepared = unknown>
  = | {
    kind: 'already-uploaded'
    uploaded: UploadedVariant
    /** Required at runtime when resumeAcrossReloads is true. */
    accessRef?: string
  }
  | { kind: 'direct', prepared: TPrepared }
  | {
    kind: 'resumable'
    prepared: TPrepared
    /** Non-sensitive opaque reference used to check who may resume the parent job. */
    accessRef: string
    contentDigest?: { algorithm: 'md5' | 'sha-256', value: string }
  }

export interface RemoteUploadSession {
  /** Persistable provider-neutral reference; it must not contain credentials. */
  resumeToken: string
  partSizeBytes: number
  expiresAt?: number
}

export interface UploadedPartReceipt {
  partNumber: number
  sizeBytes: number
  /** Opaque acknowledgement needed to complete the remote upload. */
  receipt: string
}

export interface ResumableUploadPort<TContext = unknown, TPrepared = unknown> {
  createSession: (request: {
    /** Stable local idempotency key, reused if the response is lost. */
    uploadId: string
    upload: UploadVariantRequest<TContext>
    prepared: TPrepared
  }) => Promise<RemoteUploadSession>
  inspectSession: (request: {
    resumeToken: string
    context: TContext
    signal: AbortSignal
  }) => Promise<
    | { status: 'uploading', completedParts: readonly UploadedPartReceipt[] }
    | { status: 'finalizing', completedParts: readonly UploadedPartReceipt[] }
    | { status: 'completed', uploaded: UploadedVariant }
    | { status: 'expired' }
    | { status: 'not-accessible' }
  >
  uploadPart: (request: {
    resumeToken: string
    partNumber: number
    offset: number
    bytes: Blob
    context: TContext
    signal: AbortSignal
  }) => Promise<UploadedPartReceipt>
  completeSession: (request: {
    resumeToken: string
    completedParts: readonly UploadedPartReceipt[]
    descriptor: {
      fileName: string
      relation: UploadVariantRequest<TContext>['relation']
      metadata: UploadVariantRequest<TContext>['metadata']
      contentDigest?: { algorithm: 'md5' | 'sha-256', value: string }
    }
    context: TContext
    signal: AbortSignal
  }) => Promise<UploadedVariant>
  abortSession: (request: {
    resumeToken: string
    context: TContext
    signal: AbortSignal
  }) => Promise<void>
}

export interface UploadPort<TContext = unknown, TPrepared = unknown> {
  /** Stable implementation identity used to reject incompatible checkpoints. */
  readonly adapterId: string
  readonly checkpointVersion: number
  prepare: (request: UploadVariantRequest<TContext>) => Promise<UploadPreparation<TPrepared>>
  uploadDirect: (request: {
    upload: UploadVariantRequest<TContext>
    prepared: TPrepared
  }) => Promise<UploadedVariant>
  checkResumeAccess?: (request: {
    accessRef: string
    context: TContext
    signal: AbortSignal
  }) => Promise<'allowed' | 'denied'>
  restoreUploadedVariant?: (request: {
    uploaded: PersistedUploadedVariant
    context: TContext
    signal: AbortSignal
  }) => Promise<UploadedVariant>
  resumable?: ResumableUploadPort<TContext, TPrepared>
}
```

`UploadPort` 是核心包定义的存储无关接口；`CreatlyUserFileUploadAdapter` 这类宿主实现才是 adapter。
公共类型不出现 OSS、S3、STS、对象 key、ETag 或厂商 SDK 类型。秒传、摘要协议、鉴权刷新、远端会话
创建和用户文件登记都属于宿主 adapter；AssetService 负责切片、有限并发、重试、总进度、checkpoint、
OPFS staging、取消和失败语义。adapter 是浏览器端代码，不表示新增服务端 AssetService。

`prepared` 是只在当前标签页内短暂存在的宿主状态，AssetService 不读取、结构化克隆或持久化它；
`prepare()` 中已经计算的 MD5、秒传结果或临时 client 可以通过该值交给紧随其后的上传步骤，避免
依赖未声明的全局变量或重复读取大文件。只要 `prepare()` 已经计算摘要，就必须在 preparation 中返回；
`already-uploaded` 使用 `uploaded.contentDigest`，`resumable` 使用同名 preparation 字段，不保存两份可能
冲突的值。AssetService 在 `createSession()` 或任何远端分片请求前将摘要保存到父任务和 session。
完全不使用摘要的宿主可以省略该字段。

`prepare()` 先执行宿主秒传判断，再明确返回已完成、直传或可恢复上传。恢复时把 checkpoint 中的
`knownContentDigest` 显式传回 `prepare()`；adapter 必须复用兼容摘要，不重复读取整个大文件。只有
`resumeAcrossReloads = true` 时才允许返回 `resumable`；否则 `uploadDirect()` 可以在 adapter 内使用
当前页面有效的 provider-managed multipart，但不会产生持久 checkpoint。返回 `resumable` 时必须同时
提供 `resumable` port，否则初始化直接报 `UPLOAD_ADAPTER_INVALID`。反过来，调用方要求恢复时，除
`already-uploaded` 外返回 `direct` 也属于 adapter contract error，不得静默违背请求。要求恢复时，
`resumable` 和 `already-uploaded` 都必须得到 `accessRef`，并且 port 必须实现 `checkResumeAccess()` 与
`restoreUploadedVariant()`；否则返回 `UPLOAD_RESUME_UNAVAILABLE`。同一
`resumeToken + partNumber` 的 `uploadPart()` 必须可以安全重试，`completeSession()` 也必须可以重试。
`createSession()` 必须把 AssetService 生成的稳定 `uploadId` 当作幂等键：创建响应丢失后，用同一值重试
必须返回同一个远端会话。宿主不能支持该条件时不得注册 resumable port；远端自行清理孤儿会话的 TTL
仍应作为 compatibility gate 的检查项。
`inspectSession()` 是恢复必需接口：浏览器可能在远端确认分片后、写入 IndexedDB 前关闭，恢复时必须
以远端结果为准，不能只相信本地 checkpoint。`finalizing` 表示对象字节已经完成但宿主业务登记尚未
确认；`completeSession()` 必须能够核对对象并幂等补做登记。只有对象与宿主业务记录都完成后才能返回
`completed`。无法用当前 context 访问的会话返回 `not-accessible`，不能向调用方暴露其业务信息。
`restoreUploadedVariant()` 只刷新当前可用 URL 和宿主可恢复字段，返回的 `remoteFileId`、`profileId` 与
已有可信摘要必须和持久结果一致；冲突时返回 `ASSET_IDENTITY_CONFLICT`，不能替换父任务身份。

只有 `profileId` 与请求 profile 完全相等的 `existingVariants` 才能跳过转码。宿主只能返回文件 ID、
尺寸或用途标签时，这些文件仍可按 `variantId = remoteFileId` 播放和缓存，但不能推断为当前生成配方。

### 12.3 上传顺序

1. 检查 source 的容器、codec 和音轨。source 可直接播放时把它作为 `playback`；否则在远端上传前确认
   `compatibilityProfileId` 和媒体处理能力可用，缺失时立即失败。
2. 调用 source 的 `prepare()`，得到秒传、直传或可恢复上传结论。`resumeAcrossReloads = false` 时，
   `already-uploaded` 直接复用，`direct` 立即把 `prepared` 交给 `uploadDirect()`；这条路径不承诺页面重开
   恢复。
3. `resumeAcrossReloads = true` 时验证完整 capability，并创建父级 `uploadJobs` checkpoint。只要 source
   仍需上传，或兼容版本、优化版本仍需读取 source，就预留空间并把原始 `File` 写入
   `jobs/<jobId>/source.bin`；秒传命中不能跳过仍被派生任务需要的 source。
4. 只有 `source.bin` 移动完成且随后短事务提交 `sourceStaging.status = ready` 后才承诺可恢复。两种
   存储不构成原子事务；移动后、状态提交前中断时由启动扫描核对并补交状态。若初次复制只留下
   `.partial`，启动扫描删除部分文件并报告 `UPLOAD_STAGING_INTERRUPTED`，且不开始远端传输。
5. source 需要远端上传时，创建 `status = staging` 的 session，使其 `payloadOpfsPath` 指向父级
   `source.bin`，不复制第二份大文件。用稳定 `uploadId` 调用 `createSession()`，再持久化非敏感
   `resumeToken`、分片大小和远端截止时间。
6. 调用 `inspectSession()`，从 staging 文件切片，只上传远端缺失分片。每次确认后更新
   `uploadSessions`，最后调用 `completeSession()`。远端 session 过期时把原 child 标记为 `expired`，
   生成新的 `uploadId`，用保留的 digest 和 staging 重新 `prepare()` 并创建替代 session；该过程不删除
   父任务。
7. 取得稳定 `remoteFileId` 后，以 `assetId = remoteFileId`、`sourceRevision = 1` 登记原文件；当前 URL
   只返回给本次调用，不写入父 checkpoint。重新关联时由宿主提供新 revision。
8. 读取 adapter 返回的已有派生文件，只复用 `profileId` 精确匹配的版本。source 不可播放时，只生成并
   上传 `compatibilityProfileId`；失败时主任务失败，不提交业务绑定。每个待上传 rendition 先写入可重读
   的 `sessions/<uploadId>/payload.bin`，不能把转码流作为唯一上传来源。
9. source 和 `playback` 就绪后，先一次解码生成并逐档上传仍缺少的 `requiredProfileIds`。已有精确
   profile 的版本直接登记为可用，不重复处理；任一 required profile 失败时主任务失败，不提交业务绑定。
10. 对仍缺少且不属于 required 集合的 `optimizationProfileIds` 创建独立 `optimizationJobId`，以
    `background` 优先级入队但不等待执行。
11. 形成 `status = ready` 的结果。持久任务保存包含 `optimizationJobId` 的无 URL 结果并进入
    `awaiting-business-commit`；非持久任务只在当前 `AssetTask` 内存中保留结果。主任务此时 resolve，
    已保证 required profile 可用，但不等待任何可选优化清晰度。
12. 普通编辑入口可以只使用 `playback` 立即通过 editor command 保存绑定；审片入口必须在同一个主任务
    返回后才调用审片 API，因此会被 required profile 门禁阻断。业务写入成功后调用
    `acknowledgeUpload()`。该调用把 `businessStatus` 改为 `committed` 并记录 `businessCommittedAt`，但
    优化任务未结束时不删除父 checkpoint 或 source staging。保存失败时不确认，允许再次提交。
13. 优化任务在独立 `MediaProcessingWorker` 中一次解码、多路输出，并逐档上传和登记。单档完成后立即
    更新 `variantRecords` 并发送 `job-updated`；播放器可以切换到新版本，但从不等待它。
14. 优化档位处理或上传失败只写入 profile 状态和错误码。自动尝试达到上限后状态为
    `succeeded-with-errors`；用户可以显式重试失败 profile 或取消剩余优化，主上传结果仍为 `ready`。
15. 业务已确认且优化状态为 `succeeded` 或 `cancelled` 后，删除不再需要的 child session、父 checkpoint
    和 staging；`succeeded-with-errors` 保留到显式重试、取消或到期。需要缓存 source 时原子移动到
    `objects`。固定期限到达也停止优化并清理本地 checkpoint，但不删除远端文件。
16. `discardUpload()` 只用于业务绑定前明确放弃主任务。业务已确认后，取消的是优化任务，不得撤销节点、
    审片记录或已经上传的 source。

全部标签页关闭后不承诺继续传输，但再次打开页面可以恢复。`resumeUpload(jobId, context)` 必须重新注入
当前业务 context 和凭证；这些信息不写入 IndexedDB。`adapterId` 或 `checkpointVersion` 不匹配时返回
明确错误，不能猜测旧协议。远端会话过期但父任务与 staging 仍有效时废弃该 child 并重新 prepare；
父任务或 staging 已过期时才要求重新选择文件或丢弃 checkpoint。

业务协议写入必须发生在 source 和条件性兼容版本完成之后。AssetService 任务不进入 editor undo/redo；
业务命令失败时保留 `awaiting-business-commit`，已经上传的远端文件仍由宿主的既有资源策略处理。父任务超过固定
`retainUntil` 后可以清理本地 checkpoint，但前端不会因此删除远端文件。

AssetService 只能保证恢复时不重复上传和转码，不能单独保证宿主业务写入恰好一次。业务写入成功但
`acknowledgeUpload()` 前中断时，宿主应优先把 `jobId` 作为幂等键；现有 API 不支持时，先按稳定
`remoteFileId` 和目标业务状态核对是否已经绑定。无法可靠核对的入口不得自动重放，只显示待提交结果，
由用户再次确认。

## 13. 公共 API

```ts
export interface RemoteVariantLocation {
  url: string
  urlExpiresAt?: number
}

export interface ResolveAssetRequest {
  ref: AssetVariantRef
  fallbackUrl?: string
  cacheOnMiss?: boolean
  priority?: 'interactive' | 'background'
}

export interface CacheAssetRequest {
  ref: AssetVariantRef
  url: string
  priority?: 'interactive' | 'background'
}

export interface AssetJobSnapshot {
  jobId: string
  kind: AssetJobKind
  status: AssetJobStatus
  phase?: string
  progress?: number
  errorCode?: string
  businessStatus?: UploadJobCheckpoint['businessStatus']
  optimizationStatus?: UploadJobCheckpoint['optimizationStatus']
  profileStatuses?: readonly AssetProfileJobSnapshot[]
  updatedAt: number
}

export interface AssetProfileJobSnapshot {
  profileId: string
  status: 'queued' | 'processing' | 'uploading' | 'ready' | 'failed' | 'cancelled'
  attemptCount: number
  errorCode?: string
}

export interface AssetCacheSnapshot {
  ref: AssetVariantRef
  status: AssetCacheStatus | 'not-cached'
  sizeBytes?: number
  lastAccessAt?: number
  evictAfter?: number
  failureCode?: string
}

export interface AssetCacheReport {
  reason: 'scheduled' | 'quota-pressure' | 'quota-error' | 'explicit'
  removedEntries: number
  removedBytes: number
  retainedLeaseEntries: number
  trackedBytes: number
}

export type AssetEvent
  = | { type: 'job-updated', job: AssetJobSnapshot }
    | { type: 'cache-updated', cache: AssetCacheSnapshot }
    | { type: 'cache-clearing' }

export interface AssetTask<TResult> {
  readonly jobId: string
  readonly result: Promise<TResult>
  subscribe: (listener: (snapshot: AssetJobSnapshot) => void) => () => void
  cancel: () => Promise<void>
}

export interface UploadedAssetResult {
  jobId: string
  status: 'ready'
  source: UploadedVariant
  /** Source when compatible; otherwise the completed compatibility rendition. */
  playback: UploadedVariant
  /** Snapshot at the time the business-ready result is returned. */
  availableVariants: readonly UploadedVariant[]
  optimizationJobId?: string
}

export interface AssetOptimizationResult {
  jobId: string
  status: 'succeeded' | 'succeeded-with-errors' | 'cancelled'
  readyProfileIds: readonly string[]
  failedProfileIds: readonly string[]
}

export interface RecoverableUploadSummary {
  jobId: string
  continuationRef: string
  businessStatus: UploadJobCheckpoint['businessStatus']
  updatedAt: number
  retainUntil: number
}

export interface ResumeUploadRequest<TContext = unknown> {
  jobId: string
  context: TContext
}

export interface RetryOptimizationProfilesRequest<TContext = unknown> {
  jobId: string
  profileIds: readonly string[]
  context: TContext
}

export interface UploadCheckpointRequest<TContext = unknown> {
  jobId: string
  context: TContext
}

export interface CancelOptimizationRequest<TContext = unknown> {
  jobId: string
  context: TContext
}

export interface AssetServiceOptions<TContext = unknown, TPrepared = unknown> {
  /** Must match the namespace configured in the Worker runtime. */
  expectedCacheNamespace: string
  /** Host-owned factory, for example a Vite ?sharedworker&inline constructor wrapper. */
  createSharedWorker: () => SharedWorker
  uploadPort?: UploadPort<TContext, TPrepared>
  refreshRemoteVariant?: (request: {
    ref: AssetVariantRef
    previousUrl?: string
    signal: AbortSignal
  }) => Promise<RemoteVariantLocation | undefined>
}

export declare function createAssetService<TContext = unknown, TPrepared = unknown>(
  options: AssetServiceOptions<TContext, TPrepared>,
): AssetService<TContext>

export interface AssetUrlHandle {
  url: string
  source: 'opfs' | 'url'
  release: () => void
}

export interface AssetService<TContext = unknown> {
  getCapabilities: () => Promise<AssetCapabilities>
  upsertAsset: (asset: AssetRecord, variants: readonly AssetVariantRecord[]) => Promise<void>
  resolve: (request: ResolveAssetRequest) => Promise<ResolvedAsset>
  resolveUrl: (request: ResolveAssetRequest) => Promise<AssetUrlHandle>
  ensureCached: (request: CacheAssetRequest) => Promise<AssetJobSnapshot>
  getJobStatus: (jobId: string) => Promise<AssetJobSnapshot | undefined>
  upload: (request: UploadAssetRequest<TContext>) => AssetTask<UploadedAssetResult>
  listRecoverableUploads: (context: TContext) => Promise<readonly RecoverableUploadSummary[]>
  resumeUpload: (request: ResumeUploadRequest<TContext>) => AssetTask<UploadedAssetResult>
  retryOptimizationProfiles: (
    request: RetryOptimizationProfilesRequest<TContext>,
  ) => AssetTask<AssetOptimizationResult>
  cancelOptimization: (request: CancelOptimizationRequest<TContext>) => Promise<void>
  acknowledgeUpload: (request: UploadCheckpointRequest<TContext>) => Promise<void>
  discardUpload: (request: UploadCheckpointRequest<TContext>) => Promise<void>
  getCacheStatus: (ref: AssetVariantRef) => Promise<AssetCacheSnapshot>
  subscribe: (listener: (event: AssetEvent) => void) => () => void
  sweep: () => Promise<AssetCacheReport>
  clearCache: () => Promise<AssetCacheReport>
  release: (leaseId: string) => void
  close: () => void
}

export type ResolvedAsset
  = | { source: 'opfs', file: File, leaseId: string }
    | { source: 'url', url: string }
```

`resolve()` 默认不等待网络下载。缓存未命中时立即返回当前 URL，并按请求优先级启动后台缓存。
需要离线文件的调用方可以显式调用 `ensureCached()` 并等待完成。
Worker 对不同缓存键执行统一调度：默认最多同时下载两个文件，其中后台任务最多一个，为交互请求保留
至少一个槽位。同一缓存键只下载一次；已经排队的后台任务收到交互请求时提升优先级，不新增下载。
签名 URL 需要刷新时，标签页内的 `AssetService` 调用 `refreshRemoteVariant()`，把结果只随当前缓存
请求传给 Worker 后重试；Worker 不持久化宿主函数、远端 URL 或鉴权凭证。宿主没有提供刷新回调且
本地、请求 URL 均不可用时，解析明确失败。

`resolveUrl()` 把 OPFS `File` 转为对象 URL，并返回幂等的 `release()`；URL fallback 的 `release()`
为空操作。现有 `MediaAssetCatalog.resolveForPreview()`、`resolveForExport()` 和字符串 resolver 继续
保留，但它们不创建无法释放的对象 URL。新增 handle 版本供 renderer 与 compose 迁移；renderer
接受字符串或 `AssetUrlHandle`，在素材替换、刷新和销毁时释放旧 handle，compose 在作业结束时释放。
`clearCache()` 回收当前 `cacheNamespace` 内可重新取得的静态缓存文件，保留逻辑素材记录、上传
checkpoint 和 staging。`discardUpload({ jobId, context })` 才表示放弃一项可恢复上传，并使用当前
context 尝试终止远端会话及删除对应 staging。退出登录和切换账号均不调用这两个清理 API。

`listRecoverableUploads(context)` 通过宿主 port 检查当前 context，只返回可访问任务；摘要仅包含
`jobId`、`continuationRef`、状态、更新时间和过期时间，不包含文件名、远端文件 ID、`resumeToken` 或
分片 receipt。`continuationRef` 由宿主定义，只用于找到对应节点、审片导入或其他业务操作；AssetService
不解释它，也不把它加入素材身份或缓存键。它不能包含凭证、签名 URL 或私密业务数据。

列表结果不是后续操作的授权凭据。凡是操作持久 `uploadJobs` checkpoint，`resumeUpload()`、
`retryOptimizationProfiles()`、`cancelOptimization()`、`acknowledgeUpload()`、`discardUpload()` 和
`AssetTask.cancel()` 每次都必须用各自
收到的当前 context 独立调用 `checkResumeAccess()`；返回 `denied` 时报告 `UPLOAD_ACCESS_DENIED`，不得
改变 checkpoint、删除 staging 或尝试远端 abort。这样知道另一个登录会话的 `jobId` 也不能操作其未
完成任务。未要求跨刷新恢复的任务没有 `accessRef`，只能由原 client session 和当前 task owner 操作；
它不出现在恢复列表中，retry、acknowledge 和 cancel 不调用恢复权限 hook。

`resumeUpload()` 对 `awaiting-business-commit` 任务不重复 source 上传或兼容版本处理，只恢复当前可用
URL 并返回持久结果；独立优化任务可以同时保持 `queued`、`running` 或 `paused`。调用方要重试优化结果
中的 `failedProfileIds` 时显式调用 `retryOptimizationProfiles()`；它只接受当前 policy 中已经失败的
优化 profile。持久任务先做 access check，再从保留的 source staging 或缓存重新处理；非持久任务仅在
原 client session 仍持有 source 时允许重试。未失败、已经 ready 或超过固定期限的 profile 不能被该 API
重跑。

`acknowledgeUpload()` 同样先检查当前 context；它只在业务 command 或 API 成功后把 `businessStatus`
改为 `committed` 并记录 `businessCommittedAt`，不删除远端文件。没有后台优化时可以立即清理父
checkpoint；优化仍在运行或
处于 `succeeded-with-errors` 时，checkpoint 和 source 保留到成功、显式取消或固定期限。该操作保持
幂等。`AssetTask.cancel()` 只在主结果返回前
表示取消上传；主结果返回后调用方使用 `cancelOptimization()` 停止剩余优化，不能撤销已经完成的业务
绑定。`discardUpload()` 只用于从恢复列表明确放弃尚未完成或仍待业务写入的主任务。

## 14. 一致性与恢复

Worker 启动时执行轻量恢复：

1. 只把 owner 租约已经到期的运行中派生任务改为 `interrupted`，并把对应上传任务改为 `paused`；不能
   因本 runtime 没有内存任务就覆盖另一个 runtime 的有效 owner。
2. 只把 `writerLeaseUntil` 已到期的 `downloading`、`writing` 缓存记录改为可重试的 `failed`，错误码为
   `ASSET_JOB_INTERRUPTED`；未到期记录继续等待，过期记录不能阻止同一 key 被重新认领。
3. 删除超过 1 小时的普通 `temp` 文件；`upload-staging` 只按上传会话生命周期清理。
4. 抽查 `ready` 记录；解析时始终再次确认文件存在。
5. 距离上次完整扫描超过 6 小时时，核对全部 `cacheEntries` 与 OPFS `objects`。
6. 删除孤儿文件；删除指向缺失文件的缓存记录。
7. 发现旧 source revision 时只标记为优先清理，不删除逻辑素材记录。
8. Worker 只向 AssetService 返回尚未到期且 adapter 版本兼容的不透明上传候选；页面调用
   `listRecoverableUploads(context)` 后由宿主 port 检查访问权，再决定是否显示和恢复。Worker 不自行
   请求宿主 API。
9. 双向核对 `uploadJobs`、`uploadSessions` 和 `upload-staging`：无记录目录超过 1 小时后删除；缺少
   payload 的未完成 session 在无法从父 source 重建时标记不可恢复；初次 source staging 未完成的父
   任务标记 `UPLOAD_STAGING_INTERRUPTED` 且不列出；父任务到期时级联删除全部 child 和 staging。

IndexedDB schema 升级使用 `idb.openDB()` 的 `upgrade`。`blocking` 时旧 Worker 关闭数据库连接并通知
客户端刷新；`blocked` 超时后新客户端进入 `url-only`，不让不兼容 schema 的 runtime 同时写入。同一
schema 的新旧构建可以并存，但都必须遵守持久租约和 fencing。

## 15. 权限与隐私

- 隔离边界是浏览器 origin 与稳定 `cacheNamespace`，不是账号或项目。同一引用的静态字节允许跨登录
  会话复用，退出登录和账号切换不删除缓存。
- AssetService 只解析当前已授权业务状态显式提供的 `AssetVariantRef`。IndexedDB 不提供面向业务的
  全量素材列表，缓存命中也不代替服务端权限检查。
- 带鉴权信息的远端 URL、访问令牌、云存储临时凭证、签名分片 URL 和完整请求头均不写入共享存储。
  每次缓存未命中，由当前页面提供可用 URL 或调用宿主刷新；URL 只随单次下载请求进入 Worker 内存。
- 上传 checkpoint 只保存可持久化的非敏感 `resumeToken` 和分片 receipt；恢复时重新注入当前 context
  和凭证，adapter 必须再次验证远端会话可访问。
- OPFS 不是加密保险箱。同源脚本和使用同一浏览器 profile 的用户理论上可以访问其中的字节。产品应
  提供显式「清理本地缓存」入口；对一次性敏感资源，调用方可以设置 `cacheOnMiss = false`。

## 16. IndexedDB 依赖决策

引入 `idb@^8.0.3`，并在根 `pnpm-workspace.yaml` catalog 中统一版本；`@video-editor/assets` 将其声明为
运行时依赖。

选择 `idb` 的原因：

- API 接近标准 IndexedDB，只增加 Promise、事务完成信号和少量便捷方法。
- `DBSchema` 可以约束 object store、主键、值和索引类型。
- `openDB()` 直接支持 `upgrade`、`blocked`、`blocking` 和 `terminated`，适合 SharedWorker。
- 当前功能不需要 Dexie 的 live query、复杂查询层和插件体系。
- `idb-keyval` 只适合简单键值存储，无法表达本方案需要的状态、时间和复合索引。
- localForage 的多存储后端回退会模糊 IndexedDB 是必需元数据能力这一事实。

参考资料：

- [idb 官方仓库](https://github.com/jakearchibald/idb)
- [WorkerGlobalScope.indexedDB](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/indexedDB)
- [StorageManager](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager)
- [SharedWorker](https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker)

## 17. 迁移计划

### M1：包、协议与能力检测

- 新建 `packages/assets`，加入 `idb` 和现有 `opfs-tools`。
- 定义身份、记录、RPC、错误、任务和能力类型。
- 提供可由宿主打包的 Worker runtime 入口、`createSharedWorker` 注入点和浏览器测试夹具。
- 不改 renderer 或宿主行为。

### M2：IndexedDB、OPFS 与 SharedWorker

- 实现七个 object store、短事务 helper 和 schema 升级。
- 实现临时文件、原子移动、跨 runtime 的 IndexedDB 写入租约、同键下载去重和状态广播。
- 实现 URL 回退、对象 URL 生命周期、租约和崩溃恢复。
- 实现容量预算、TTL、全局 LRU、配额重试、显式清理和上传 staging 生命周期。

### M3：兼容现有 protocol 与 renderer

- 让 `MediaAssetCatalog` 通过 `AssetService` 读写文件，保留 RFC 0006 的字符串方法，并增加可释放
  handle 方法。
- 保留 `@video-editor/protocol` 旧 resource 导出，内部逐步委托给新包。
- renderer resolver 兼容字符串并新增 handle 返回值；renderer 和 compose 必须在生命周期结束时
  释放 handle。对已上传存量和服务端生成素材，在进入可视区域并挂载详细节点后逐步登记和 warm-up；
  不扫描整份图数据，不在 snapshot merge 中发起下载。缓存未命中不得阻塞 URL 播放。
- 将缩略图、波形和媒体元数据迁入同一缓存索引。

### M4：Worker 媒体处理

- 把 `@video-editor/media` 的内部 Canvas 创建抽象为可注入工厂。
- 在 Worker 使用 `OffscreenCanvas`；通用包保留可直接调用的底层 adapter，但 Creatly 宿主不注册
  主线程转码回退。
- 新增 `MediaProcessingWorker` RPC，避免编码占用页面主线程或 SharedWorker 的缓存消息循环。
- 扩展 `transcode()` 隔离单个输出 encoder 或 muxer 的失败：兼容版本失败终止主任务，优化版本失败只
  删除自己的临时文件并允许其他输出完成。
- 验证一遍解码、多档编码、单档失败、取消、进度和资源释放。

### M5：上传编排

- 实现 `UploadPort`、可选 `ResumableUploadPort`、`AssetIngestPolicy` 和分离的主上传、后台优化阶段。
- 支持原文件、条件性兼容 rendition、受控异步优化 rendition、分片 checkpoint、恢复和取消。
- 提供宿主集成示例，不在包内引入 OSS 或具体 API。

### M6：移除旧存储实现

- 迁移已有 `manifest.json` 时，同时用旧 URL 和 `getResourceOpfsPath()` 找到
  `/video-editor-res` 实际文件。原素材映射为 `variantId = source`；旧 proxy 映射到其 source
  revision，并用旧派生素材 ID 作为 `variantId`。
- 兼容期内 `cacheEntries.opfsPath` 可以指向已核对大小的旧文件，旧路径计入预算且不得当成孤儿，
  避免复制大文件或破坏回滚。缺失二进制的本地唯一素材不得标记为 `ready`。
- 完成两个发布周期的兼容读取后，再把旧文件移动到哈希对象路径并更新记录，最后删除旧 manifest
  写入和旧目录。
- 只有在 browser tests 和宿主集成完成后，才移除旧的实例内写入队列。

## 18. 验收与测试

### 18.1 浏览器行为

- 首次解析返回 URL 并完成 OPFS 缓存；禁止网络后刷新页面，能够从 OPFS 播放。
- 同一构建的两个标签页同时缓存同一引用，只发生一次下载和一次最终文件写入。
- 新旧构建的 inline Worker 同时存在时可以产生两个 runtime，但同一缓存键只有一个有效 IndexedDB writer；
  旧 epoch 的提交被拒绝。
- 新 runtime 执行清理时会遵守 `leaseProtectionUntil`，不会删除旧 runtime 仍在播放的文件。
- OPFS、IndexedDB 或 SharedWorker 缺失时返回 `url-only`，远端素材仍可播放。
- `ready` 记录对应文件被手动删除后，解析回退 URL 并修复记录。
- 签名 URL query 变化不产生第二份缓存；revision 或 variant 变化产生新缓存。
- 签名 URL 只随单次下载请求进入 Worker，不写入 IndexedDB、日志或广播。
- 页面预期命名空间与 Worker 固定 `cacheNamespace` 不一致时明确失败，且不打开本地存储。
- 发生 `QuotaExceededError` 后执行一次清理和重试，重试失败时仍保留 URL 播放。
- 有效租约对应的播放文件不会被清理；租约超时后可以参加 LRU。
- 项目 A 关闭后，项目 B 使用的同一素材仍命中缓存。
- 不同账号先后访问同一稳定引用时只保存一份；退出登录和账号切换不删除静态缓存。
- `clearCache()` 与其他标签页缓存写入并发时，旧 generation 的任务不能重新提交文件或 `ready` 记录。
- `clearCache()` 不取消上传，也不删除可恢复上传的 checkpoint 或 staging。
- 同一缓存引用出现不一致可信摘要时返回身份冲突，不读取错误字节。
- `usage` 或 `quota` 缺失时仍按固定预算回收，不产生 `NaN` 水位。
- `.bin` 文件以记录中的 MIME 返回，并在真实 `<video>` 元素中触发 `loadedmetadata` 或 `canplay`；视频
  对象 URL 不会因空 `File.type` 失去媒体类型。

### 18.2 状态与恢复

- Worker 中止在下载、写入和移动的每一个边界后，重启均不留下可见的半文件。
- `jobs` 中遗留的运行状态变为 `interrupted`，按需重试不会复用旧回调或凭证。
- `cacheEntries` 中遗留的 `downloading`、`writing` 变为可重试状态；终态任务按期限和数量清理。
- 另一个 runtime 的 writer 租约未到期时，启动恢复不会把其 `downloading` 或 `writing` 状态改为失败。
- IndexedDB 升级遇到旧标签页时能够通知并关闭旧连接；超时进入明确降级状态。
- 完整扫描能清理孤儿文件和无文件记录，统计字节数与 OPFS 文件总量一致。
- 旧 manifest 迁移后，本地唯一素材仍可从原 OPFS 文件读取；缺失文件不会被标记为 `ready`。

### 18.3 媒体与上传

- source 可直接播放时，主任务在 source 上传后返回 `ready`，不等待优化清晰度；播放器在优化版本缺失、
  处理中或失败时继续使用 source。
- source 不可播放时，主任务只等待一个兼容 profile；该 profile 失败时不提交业务绑定，完成后立即返回
  `ready`，其余清晰度继续在后台处理。
- 普通编辑 policy 不配置 required profile，用户可以在母版上传后立即使用素材；审片 policy 把客户播放
  所需的精确清晰度放入 `requiredProfileIds`，全部就绪后才能创建审片版本，任一档失败时不得发布。
- 存量和服务端生成素材在挂载到可视区域附近时才登记并以后台优先级缓存；当前 URL 始终立即可用，后台
  下载并发默认为一，不因打开大型画布批量占用网络连接。
- 同一视频的优化任务一次解码生成多个 rendition，输出均可重新读取音视频轨和尺寸。
- 优化 profile 失败只更新受控后台任务，不把主结果改为 `partial`；达到重试上限后仍使用 `playback`。
- 宿主秒传命中时复用已有原文件和派生文件，不重复转码。
- 只有 `profileId` 精确匹配的已有派生文件跳过转码；未知 profile 不按高度或标签猜测。
- 上传完成后直接把已有 `File` 提交给缓存，不再从远端下载一遍。
- 主结果返回前取消任务时不继续上传；业务绑定后取消只停止剩余优化，不撤销 source 或业务记录。
- 大文件在分片确认后保存 checkpoint；在确认后、本地提交前中止，恢复时通过远端检查避免重复工作。
- 相同 `uploadId` 重试创建会话时得到同一远端 session；创建响应丢失不会留下无法恢复的重复上传。
- 两个标签页不能同时执行同一上传；旧 owner epoch 的晚到 checkpoint 被拒绝。
- 页面关闭后重新打开可以恢复上传；主动取消会终止远端会话并删除 staging。
- source 秒传命中但仍需生成兼容或优化 rendition 时，完整 source staging 提交后才开始转码；初次
  staging 中断不显示为可恢复任务。
- 远端 child session 过期时保留有效父任务和 staging，并创建替代 session。
- 主任务完成后进入 `awaiting-business-commit`；页面在业务写入前重开不会重复上传。业务成功确认时
  只记录提交完成，后台优化进入终态或到期后才删除仍被使用的父 checkpoint 和 source staging。
- `adapterId` 或 checkpoint 版本不匹配、OPFS 不可用、父任务过期时返回明确错误。
- `listRecoverableUploads(context)` 不返回当前 context 无法访问的任务，也不暴露恢复凭据。

## 19. 发布条件

只有满足以下条件，宿主才能默认启用 `shared-cache`：

1. 宿主通过 `createSharedWorker()` 注入可部署的构造器，并为其配置稳定 name、协议和缓存命名空间；
   实际 Worker URL 必须通过生产 CSP。
2. Chromium browser tests 覆盖 SharedWorker、IndexedDB、OPFS、同构建双标签页和新旧构建并存。
3. renderer、审片和上传入口均验证 URL 回退。
4. 缓存统计、清理原因、失败码和能力模式可被诊断。
5. 跨账号缓存复用、显式缓存清理、后台优化和断点续传边界经过测试。
6. `git diff --check`、TypeScript 检查、相关单元测试和浏览器测试通过。
