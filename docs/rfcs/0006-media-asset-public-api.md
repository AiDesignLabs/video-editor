# RFC 0006：素材公共 API

- 状态：已采纳
- 创建日期：2026-09-02
- 范围：素材术语、公共 API、渲染集成和兼容边界

## 1. 问题

当前素材能力同时出现 `assetId`、URL、OPFS `File`、proxy 和 PixiJS `Texture`。这些概念属于
不同层级，但低层 `AssetLibrary` 将其中多项直接暴露给调用方。开发者容易把素材身份、文件位置、
本地缓存和渲染资源当成同一个对象，并自行连接本应由库维护的步骤。

## 2. 术语

| 术语                  | 定义                                   | 生命周期                 | 所属层级     |
| --------------------- | -------------------------------------- | ------------------------ | ------------ |
| `MediaAsset`          | 用户可见的素材记录，使用稳定 ID 标识   | 持久化                   | 公共 API     |
| `SegmentAssetBinding` | 写入片段的素材 ID 与最后可用地址       | 随协议持久化             | 协议兼容层   |
| `AssetDerivation`     | proxy 与生成它的原始素材 revision 关系 | 持久化                   | 高级素材 API |
| OPFS `File`           | 浏览器保存的素材二进制文件             | 本地缓存或本地素材有效期 | 存储实现     |
| PixiJS `Texture`      | 图片或视频帧对应的 GPU 渲染资源        | renderer 实例有效期      | 渲染实现     |

proxy 在面向用户的 API 中称为「预览版本」。`MediaAsset.proxyStatus` 只显示 `none`、`ready` 或
`stale`，不暴露 proxy ID、来源 revision 或存储地址。

## 3. 公共 API

新增 `createMediaAssetCatalog()`。普通集成只使用 `MediaAssetCatalog`：

```ts
const assets = createMediaAssetCatalog({
  getProtectedProtocols: async () => [editor.commands.exportProtocol()],
})

const asset = await assets.import(file)
const binding = await assets.bindForSegment(asset.id)

if (binding.kind === 'audio')
  throw new Error('This example requires visual media')

editor.commands.addSegment({
  ...binding,
  segmentType: 'frames',
  type: binding.kind,
  ...(binding.kind === 'image' ? { format: 'img' as const } : {}),
  startTime: 0,
  endTime: binding.durationMs ?? 4000,
})
```

`bindForSegment()` 返回协议兼容所需的 `url`，调用方只展开返回值，不负责生成、缓存或改写地址。
后续协议版本可以允许仅保存 `assetId`；在此之前保留 `url`，避免破坏旧工程和离线恢复能力。

`getPreviewBlob()`、`getThumbnails()` 和 `getWaveform()` 按素材 ID 读取预览数据，不要求调用方
处理 OPFS `File` 或资源 URL。`resolveForPreview()` 可以选择当前有效的预览版本，
`resolveForExport()` 始终选择原始素材。两个 resolver 可直接传给 renderer 和 compose，不要求
调用方理解 `preferProxy`。

## 4. PixiJS 边界

素材目录不依赖 PixiJS Assets。音频不经过 PixiJS，视频需要媒体解码器逐帧产生 Canvas，导出也
不能依赖 PixiJS 的全局资源注册表。renderer 可以在内部使用 PixiJS 的图片加载能力，但
`MediaAsset`、`assetId` 和 proxy 关系不得映射为 PixiJS 的公共资源身份。

完整转换顺序为：

```text
assetId -> MediaAsset -> 原始素材或预览版本 -> URL / OPFS File -> 解码 -> PixiJS Texture
```

## 5. 兼容策略

- `AssetLibrary` 保留为 `protocol` 包内部实现，不再从包根入口导出。
- `MediaAssetCatalog` 不返回 `url`、`previousUrls`、`revision`、`derivation` 或 OPFS `File`。
- `MediaAssetCatalog.remove()` 在完成全部引用检查后同时删除派生素材；低层 `removeAsset()` 默认仍
  拒绝删除存在派生素材的原始素材。
- 现有片段继续保存 `assetId` 和 `url`，无需迁移。
- 缺少删除保护协议提供者时，`MediaAssetCatalog.remove()` 明确失败，不允许绕过引用检查。
- 存储适配、proxy 生成和诊断工具在 `protocol` 包内部直接使用素材 repository；未来确需向外部
  开放时，应增加可独立构建和测试的正式子路径。
- 本 RFC 不改变 PixiJS 资源加载方式，也不实现 proxy 生成任务。

## 6. Agent 使用

仓库提供 `skills/video-editor/SKILL.md`。该 skill 以公共命令、selectors、proposal 和
`MediaAssetCatalog` 为默认入口；只有在实现存储、proxy 或 renderer 本身时才读取低层素材说明。
