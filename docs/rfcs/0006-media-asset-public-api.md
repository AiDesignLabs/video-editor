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
处理 OPFS `File` 或资源 URL。`resolveForPreview()` 和 `resolveForExport()` 优先选择当前有效的
编辑优化版 MP4；不存在符合当前 source revision 与 profile 的派生素材时回退原始素材。两个
resolver 可直接传给 renderer 和 compose，不要求调用方理解 `preferProxy`。

视频预览版本通过 `generatePreviewVersion()` 生成：

```ts
const controller = new AbortController()

await assets.generatePreviewVersion(asset.id, {
  signal: controller.signal,
  onProgress: progress => updateProgress(progress.ratio),
})

await renderer.refreshAssets()
```

默认最高保留 1080p，使用高质量 H.264、192 kbps AAC 和 1 秒关键帧间隔。音频按解码块流式
转码，不把长片音轨完整读入内存。调用方可以调整参数，但不接触生成文件、代理 ID、source
revision 或生成 profile。已有当前编辑优化版时直接返回素材状态，不重复编码；非视频素材会明确
失败。

## 4. PixiJS 边界

素材目录不依赖 PixiJS Assets。音频不经过 PixiJS，视频需要媒体解码器逐帧产生 Canvas，导出也
不能依赖 PixiJS 的全局资源注册表。renderer 可以在内部使用 PixiJS 的图片加载能力，但
`MediaAsset`、`assetId` 和 proxy 关系不得映射为 PixiJS 的公共资源身份。

编辑优化版同时包含 H.264 画面和 AAC 音频。renderer 使用同一个 `resolveForPreview()` 分别解析
画面和音频，两者选择同一个当前编辑优化版。普通集成仍只需传入一个 resolver。

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
- 编辑优化版编码通过 `@video-editor/media` 完成，临时输出和素材二进制写入 OPFS；这些步骤不
  进入公共 API。旧 profile 的派生素材会自动过期，不会进入预览或合成。

## 6. Agent 使用

仓库提供 `skills/video-editor/SKILL.md`。该 skill 以公共命令、selectors、proposal 和
`MediaAssetCatalog` 为默认入口；只有在实现存储、proxy 或 renderer 本身时才读取低层素材说明。
