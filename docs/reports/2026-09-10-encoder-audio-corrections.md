# 编码画质归因与音频修正

## 结论

共享实验的画质差异发生在已测样本进入原生编码器之后，没有证据表明是这些样本的缩放、颜色转换或对象复用造成的。独立解码后并行编码也会复现差异，因此不能归因为「共享解码天然降低画质」。目前能定位到本机并行原生编码路径的码率与质量分配行为，尚未证明浏览器或操作系统内部的具体原因。

正式路径保留串行转换，已修正恒定帧率提示，并默认保留兼容 AAC。正常输入继续使用分片 MP4；只有带起点偏移且可以直接保留 AAC 的输入，使用 SDK 的普通 Fast Start MP4 和 OPFS 随机写入。必须重编码的偏移音轨仍受限，没有固定减去 44 ms，也没有强行截掉尾音。

## 画质对照

使用同一原片 `420445541600079872.mov`，916,373,926 字节、756.761542 秒、25 fps、18,918 帧。两档均为 360p/600 kbps/1 秒 GOP 与 720p/2.5 Mbps/2 秒 GOP。实验音频保持重编码 192 kbps，以免混入音频策略差异。

在原先差异最大的 411.64 秒、413.12 秒，截取真正传给 `VideoEncoder.encode` 的帧，统一读取 RGBA 像素并计算 SHA-256。不同方案的同档输入哈希、尺寸、像素格式、时间戳及 40,000 微秒时长均相同。

| 对照                          | 结果                                                           |
| ----------------------------- | -------------------------------------------------------------- |
| 串行与串行加空 `process` 回调 | 输入哈希相同，产物体积相同，未复现共享差异                     |
| 共享与显式克隆样本            | 输入哈希相同，产物体积相同，差异仍在                           |
| 共享与最多四个待处理副档提交  | 输入哈希相同，产物体积相同，差异仍在                           |
| 两个独立 `Conversion` 并行    | 仍有质量下降，360p 平均 SSIM 为 0.967916，接近共享的 0.967918  |
| 明确传入 SDK 检测到的 25 fps  | 两种方案的实际码率分配和画质均改善，但相对差异没有完全消失     |
| 明确请求 CBR                  | 本机配置被接受，但未观察到可消除当前差异的改善，不作为正式修复 |

上面的像素哈希只覆盖被检查的关键样本，不是整片逐帧哈希。全片解码、视频时间戳和 SSIM 检查另行执行，产物仍包含全部 18,918 帧。

### 帧率提示缺口

原配置未向编码器传入 `framerate`。Mediabunny 的 `Conversion.video.frameRate` 会同时处理帧率规范化和输出轨道的帧率元数据，因此不能直接对所有视频传入平均 fps。

修正方式是调用 SDK `computeFrameRateMetrics({ targetPacketCount: Infinity })`，仅在 SDK 判断整条轨道为无丢帧的恒定帧率时，传入 `underlyingFrameRate`。VFR 保留原来的时间戳，不用猜测帧率覆盖。真实的 VFR、60 fps 和 30000/1001 fps 测试验证了输出时间戳与输入一致。

| 全片实际输出分辨率 SSIM | 原串行，无帧率提示 | 串行，25 fps | 共享，25 fps |
| ----------------------- | ------------------ | ------------ | ------------ |
| 640×360                 | 0.972191           | 0.975923     | 0.972403     |
| 1280×720                | 0.987019           | 0.988361     | 0.987126     |

因此，补帧率提示是配置修正，并不是偷偷提高目标码率。实际文件会变大，这是原生编码器在正确帧率下重新分配码率的结果。共享方案没有因为这一修正而自动通过等质量验收，继续保留在实验代码中。

Chromium 当前 macOS 编码实现会把目标码率传给 VideoToolbox 的 `AverageBitRate`，并设置 `ExpectedFrameRate`；源码也说明部分码率限制会产生不足额码率。这个机制与「目标码率不是逐帧质量保证」一致，但不能用来证明本机并行差异的具体内部原因。[Chromium 源码](https://github.com/chromium/chromium/blob/main/media/gpu/mac/vt_video_encode_accelerator_mac.mm)

## 已落地的音频行为

- `TranscodeOptions.audioMode` 默认 `auto`：兼容 AAC 不设置强制编码质量，交给 SDK 直接复制；需要修改音频参数时可显式使用 `transcode`。
- `audioBitrate` 用于确实需要重编码的音轨，不再为已经兼容的 AAC 进行无必要的二次编码。
- 返回结果增加 `audioMode` 与 `containerLayout`，便于验证实际采用的方式。
- 正常输入仍采用分片 MP4。对于非同步轨道起点的 MP4/MOV，只有确认 AAC 可以直接复制，且调用方提供 `openFileSink` 时，才采用普通 Fast Start MP4。
- 普通 MP4 使用 SDK `fastStart: 'reserve'` 与 `StreamTarget`，依据源包数及 SDK 建议的预留余量设置 `maximumPacketCount`，由 OPFS 接收 SDK 的带位置写入。没有自己解析、重写 MP4 box，也不把完整产物缓冲到内存再封装。
- Asset Service、协议预览文件生成和本地实验页已提供随机写入能力；自定义调用方可通过新增的 `MediaFileSink` 接口接入。
- 仍需重编码的偏移音轨没有验证通过，继续明确报告不支持；缺少随机写入能力的调用方也不会偷偷退回错误的分片产物。

## 验证结果

### 用户原片

正式串行路径生成两档，音频解码器实例和音频 decode 调用均为 0。每档输出的 32,591 个 AAC 压缩包与原片逐包 SHA-256 一致。

| 指标                         | 修正前        | AAC 保留后                |
| ---------------------------- | ------------- | ------------------------- |
| 首段、中段、尾段新增声音偏移 | 约 47.875 ms  | 0 ms                      |
| 原生播放器时长               | 756.831202 秒 | 756.761542 秒，与原片一致 |
| 视频输出帧数                 | 18,918        | 18,918                    |
| 音频解码次数                 | 每档一次      | 0                         |

此轮包含真实帧率提示，输出大小为 78,246,369 字节与 260,608,846 字节。这个体积变化主要来自视频编码参数修正，不应误记为音频直拷带来的性能或压缩收益。

### 偏移与负时间戳素材

- 带 0.378 秒 AAC 起点的三秒 MP4：分片直拷仍被原生播放器报告为约 3.377 秒；普通 MP4 直拷为原来的 3 秒，声音位置保持不变。因此只对已验证的特殊情况选择普通 MP4。
- 通过 Asset Service 的真实 OPFS 路径验证普通 MP4 产物，AAC 包与原片一致，原片有效播放区间内的解码音频数据一致。
- 同时验证了音频晚于视频和视频晚于音频的 AAC 素材；两种起点关系均走普通 MP4 保留原时间关系。
- 有 AAC 负时间戳预滚动的普通输入继续用分片 MP4，音频包保留，未新增重编码延迟。
- 两种写入方式均验证了转码中取消和临时文件清理；取消发生在创建输出之前时，临时目录不存在也是正确结果。

## 复现与限制

实验报告与产物分别位于以下系统临时目录：

```text
/var/folders/18/2qf37tcd39x66vkhn7c4tl8m0000gn/T/video-playback-study-RTkQ4r
/var/folders/18/2qf37tcd39x66vkhn7c4tl8m0000gn/T/video-playback-study-fM120u
/var/folders/18/2qf37tcd39x66vkhn7c4tl8m0000gn/T/video-playback-study-CgdNcN
/var/folders/18/2qf37tcd39x66vkhn7c4tl8m0000gn/T/video-playback-study-A29ike
```

前两个目录是像素、队列、并行及帧率对照；第三个是 CBR 对照；第四个是用户原片的正式 AAC 保留验证。源码默认策略已随本次修正更新，复现实验时应以实际记录的编码配置为准，不把历史模式名称当作配置快照。

在 `packages/media` 中执行：

```sh
MEDIA_EXPERIMENT_SOURCE=/path/to/source.mov MEDIA_EXPERIMENT_ABLATION=1 pnpm exec vitest run --project node src/playback-experiment.integration.test.ts
MEDIA_EXPERIMENT_SOURCE=/path/to/source.mov MEDIA_EXPERIMENT_MODES=parallel,serial-fps,shared-fps pnpm exec vitest run --project node src/playback-experiment.integration.test.ts
MEDIA_EXPERIMENT_SOURCE=/path/to/source.mov MEDIA_EXPERIMENT_MODES=serial-auto-audio pnpm exec vitest run --project node src/playback-experiment.integration.test.ts
MEDIA_TEST_BUILD=production pnpm exec vitest run --project node src/conversion.integration.test.ts
```

本机 Chrome/Edge 的验证不等同于 Windows、所有硬件或全部素材兼容保证。已有服务端转码文件和本地缓存不会自动重生成，本次修正作用于新生成的产物。
