# 文件转码迁移到 Mediabunny Conversion

后续已增加恒定帧率提示、兼容 AAC 保留，以及仅供已验证偏移 AAC 使用的 OPFS 普通 MP4 输出。当前行为与验证结果见 [编码画质归因与音频修正](../reports/2026-09-10-encoder-audio-corrections.md)。下文保留初次迁移记录。

## 实现与边界

文件导入和清晰度生成使用 Mediabunny 1.56.1 的 `Conversion`。音视频解码、重采样、时间戳裁剪、缩放、旋转和编码由 SDK 负责，不再保留旧的手写文件转码循环。多档按请求顺序串行执行；初始化时检查所有必要轨道，执行时先处理到第 2 秒，再继续同一个转换任务。

输出为 fragmented MP4，视频 H.264，有源音轨时输出 AAC。保留主音视频轨道、原有帧率、清晰度与码率规则，不放大原片。音频参数由 SDK 选择；原生 AAC 不可用时，在转码 Worker 内注册官方 `@mediabunny/aac-encoder`。缺少所需能力或扩展加载失败时明确报错，不丢弃音轨后宣告成功。

Asset Service 的上传顺序、源文件去重、缓存身份与下载续传保持不变。兼容成片和必要清晰度全部完成并上传后，仍由现有业务流程提交审片版本。时间线合成、画布导出和独立性能诊断继续使用原有渲染接口。

参考：[Conversion](https://mediabunny.dev/guide/converting-media-files)、[AAC 扩展](https://mediabunny.dev/guide/extensions/aac-encoder)、[1.56.0 时间戳与转换更新](https://github.com/Vanilagy/mediabunny/releases/tag/v1.56.0)。

## 接口与生命周期

- `transcode` 保留 `source`、`renditions`、`openSink`、`signal`；增加可选 `validateOutput` 回读回调。所有业务调用方均接入回读校验，成功回调完成后才报告该档 100%。
- `TranscodeProgress` 改为 `ratio`、`renditionId`、`renditionRatio`、`completedRenditions`、`totalRenditions`、`elapsedMs`。不再生成估算帧数；诊断工具的真实逐帧统计使用单独的 `FrameProcessingProgress`。
- 删除旧转码循环的 `pipelineDepth`、`passthroughSameSize`、`decoder`、`createCanvas`、`latencyMode` 选项，以及虚构不出的内部阶段耗时、直通状态和编码器配置结果。同步迁移协议预览、Worker、前端调用方与性能实验页。
- 回读检查非空产物、H.264/AAC、实际尺寸、必要音轨及总时长；时长容差为 250 ms。测试另用独立解码检查音画标记，容差 50 ms。
- SDK 的 `AppendOnlyStreamTarget` 负责追加写入。OPFS 消费端可能转移并分离数据缓冲区，因此字节计数在提交写入之前取得。
- 取消时调用 SDK `cancel()`，取消输出写入并释放输入；Asset Service 等待写入任务结束后删除临时文件。不会返回或上传部分产物。
- Worker 传递 `MEDIA_CONVERSION_FAILED`、阶段、清晰度 ID 和 SDK 版本。前端将转换失败与上传失败分开，并展示具体原因。

前端媒体 Worker 改为同源 `?worker&url`，复用现有 `/creatly-static/canvas/` 静态路由。原 `?worker&inline` 在生产构建中无法解析 SDK 分包的相对模块路径；该问题已有生产构建回归测试。

## 已知限制

1. HDR 本期明确拒绝，不自行实现色调映射。10-bit SDR 在浏览器解码能力可用时转换，否则明确报告源编码不支持。
2. **Mediabunny 1.56.1 对 MP4/MOV 的非同步轨道起点存在已复现的时间偏差。** 3 秒视频搭配延后 0.4 秒的 PCM 音轨，独立 ffprobe 读取产物约为 3.4667 秒；AAC 音轨对应产物约为 3.444 秒。SDK 自身回读不足以发现这一差异。
3. 首期在转换前拒绝上述容器中不同起点的主音视频轨道。判断通过 SDK 公开的轨道时间接口完成，不修改样本或修补 SDK。零时刻前的编码预滚动不按正向起点偏移处理。此限制覆盖多个非零起点组合，范围比已复现的两个样本更保守。
4. `offset.mov`、`offset-aac.mp4` 是可重复生成的最小回归素材。未向外部提交 issue；后续升级 SDK 时，需先取消测试中的拒绝预期并通过独立时间与同步校验，再移除支持边界。
5. 串行转换接受重复解码的性能代价。不增加旧引擎回退、后端转码或完整 ffmpeg.wasm。

## 验证记录

### 后续诊断：轨道偏移与共享解码

本节更新前面的初步归因，诊断代码不进入正式转码路径。

- 3 秒 PCM MOV 的声音原定在 0.4 秒开始。fMP4 输出在 Chrome 与 ffprobe 中均报告约 3.4667 秒，但实际声音在约 0.4440 秒开始，未被移动到 0 秒。普通 MP4 输出约 3.0667 秒，声音起点不变。因此，主要时长异常与分片 MP4 对非零音轨起点的时长表示有关；另有几十毫秒的编码延迟，需要单独处理和验收，不能用截短总时长代替音画同步验证。
- 普通 MP4 诊断使用 `BufferTarget` 和 `fastStart: 'in-memory'`，仅用于小文件验证。大文件实现不能直接照搬全量内存缓冲，应采用可随机写入的 OPFS 输出方案。
- SDK 内置轨道数组 fan-out 在 75 帧素材上创建 2 个视频解码器，提交 150 个视频包，不保证共享解码。
- 另一项验证使用一个主 `Conversion`，通过其公开 `process` 回调将规范化后的样本传递给 SDK `VideoSampleSource`、`AudioSampleSource`。只创建 1 个视频解码器、提交 75 个视频包，生成两个独立 MP4，第二档经 ffprobe 确认包含完整的 75 个视频包。尚未完成真实长视频的性能和同步矩阵，未替换正式串行实现。
- 实验页 `timing.fps` 等于源帧数除以总耗时，是源视频等效处理速度。双档串行输出时它既不是纯解码吞吐，也不是两档输出帧率之和。18,918 帧 / 64.576 秒约为 293 fps；两个产物合计输出吞吐约为 586 帧/秒。

诊断命令：

```sh
MEDIA_TEST_DIAGNOSTICS=1 pnpm exec vitest run --project node src/conversion.integration.test.ts -t 'measures SDK'
```

2026-09-10，本机 macOS：

| 项目                                             | 结果                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| Chrome 153.0.8010.36 生产 Worker                 | 19 项通过                                                        |
| Edge 150.0.4078.83 生产 Worker                   | 19 项通过                                                        |
| 前端 Vite 7 生产构建、CDN 前缀与实际 Worker 工厂 | 原生 AAC、官方 AAC 扩展及 OPFS 产物均通过                        |
| 975,736,835 字节 MOV，120 秒，720p，25 fps       | Asset Service 生成 96p、48p 两档，约 13.7 秒                     |
| 音画同步                                         | 在合成素材首段、中段、尾段验证脉冲音与白色画面，偏差不超过 50 ms |

素材集覆盖 32/44.1/48 kHz、单声道/双声道/5.1、无音轨、AAC 负时间戳、旋转 MOV、可变帧率、10-bit HEVC SDR，以及 HDR、损坏文件和已知偏移问题的明确拒绝。补充验证了 AAC 扩展加载失败、必要轨道丢失、写入失败和转码中取消清理。

同机性能对比：基线提交 `8b0bf6630d62dd0425081d4bd64ddde9aad732c7`，输入为 984,948,033 字节、120 秒、720p/25 fps 的 AVC + PCM MOV，输出 96p/48p。SDK 串行约 14.0 秒，旧循环约 3.5 秒。两者使用相同 SDK 版本；SDK 路径包含产物回读，旧循环不包含，且旧循环在 SDK 路径之后运行，可能受系统缓存影响。此结果用于说明该场景的端到端代价，不代表所有素材的固定倍率。

**未验证：** Windows Chrome/Edge、解码器和 GPU 的真实峰值内存、所有用户真实素材。大文件是 FFmpeg 生成的恒定码率测试素材；结果不能等同于长时间复杂素材或手机浏览器表现。发布前仍需补齐 Windows 验收，本轮不部署。

## 复现命令

前置依赖：pnpm、FFmpeg/ffprobe，以及所选浏览器。素材由测试生成到系统临时目录，测试结束后清理。以下命令在 `packages/media` 中执行：

```sh
pnpm exec vitest run --project node
pnpm exec vitest run --project browser src/media-workflows.browser.test.ts
MEDIA_TEST_BUILD=production pnpm exec vitest run --project node src/conversion.integration.test.ts
MEDIA_TEST_BUILD=production MEDIA_TEST_BROWSER=msedge pnpm exec vitest run --project node src/conversion.integration.test.ts
MEDIA_TEST_BUILD=production MEDIA_TEST_LARGE=1 pnpm exec vitest run --project node src/conversion.integration.test.ts -t near-1GB
MEDIA_TEST_BUILD=production MEDIA_TEST_LARGE=1 MEDIA_TEST_BASE_REF=8b0bf6630d62dd0425081d4bd64ddde9aad732c7 pnpm exec vitest run --project node src/conversion.integration.test.ts -t near-1GB
```

性能对比仅在临时目录读取并构建指定 Git 版本的旧循环，不在生产包中保留旧引擎。Windows 可通过 PowerShell 的 `$env:MEDIA_TEST_BROWSER = 'msedge'` 等语法设置相同环境变量。

前端在 `creatly-fe2/apps/ailsc-global` 执行：

```sh
pnpm exec vitest run --config app/asset-service/vitest.config.ts app/asset-service/infrastructure/mediaProcessorProduction.test.ts
pnpm exec vitest run --config app/creation-graph/vitest.config.ts app/creation-graph/tests/editor-preview-import-asset-service.test.ts
```

本地联调继续使用 `@video-editor/*` 本地链接；发布包版本和消费者依赖需要在后续发布时同步更新。
