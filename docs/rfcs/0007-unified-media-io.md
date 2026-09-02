# RFC 0007：统一媒体输入与输出

- 状态：已接受
- 范围：`@video-editor/media`

## 背景

渲染 Canvas 动画、实时传输 Canvas 画面和截取已有视频都需要处理时间、取消、进度与资源释放。
三类操作共享基础约束，但运行时语义不同：离线合成由媒体时间驱动，实时流由墙上时钟驱动，视频
截取由输入文件的时间范围驱动。将三类操作合并为一个带模式开关的 API，会使错误处理和生命周期
难以判断。

## 决策

`@video-editor/media` 分别提供以下 API：

- `renderCanvasToVideo()`：按精确媒体时间调用 `renderFrame()`，并将 Canvas 帧编码到输出 sink。
- `captureCanvasStream()`：按实时会话生成 `MediaStream`，支持自动取帧和手动 `requestFrame()`。
- `trimVideo()`：截取输入媒体的时间范围，并将主视频轨和主音频轨写入输出 sink。

三个 API 不负责业务上传、工程协议写回、WebRTC 信令、Three.js 动画状态或素材持久化。

## 共同契约

### 时间

- 公开 API 中的媒体时间统一使用毫秒。
- `renderCanvasToVideo()` 使用 `frameIndex * 1000 / fps` 计算每帧时间，不依赖屏幕刷新率。
- `captureCanvasStream()` 使用实时会话时钟。`requestFrame()` 只提交当前画面，不改变时间语义。
- `trimVideo()` 使用左闭右开的 `[startMs, endMs)` 范围。

### 能力检查

- 必需的 WebCodecs、编码器、Canvas 或视频轨道生成器不可用时，在启动主要工作前返回明确错误。
- 不使用 `MediaRecorder` 或其他行为不同的实现进行静默降级。
- OffscreenCanvas 实时流在目标浏览器支持视频轨道生成器后才可使用。

### 取消与错误

- 离线 API 接受 `AbortSignal`。取消后以名称为 `AbortError` 的异常结束。
- 渲染回调、媒体转换或 sink 写入失败时，任务失败并释放已经创建的编码器、输入与轨道资源。
- 必需音轨存在但无法处理时，任务失败；不得静默生成无声输出。

### 输出 sink

- 调用方创建并传入 `WritableStream<Uint8Array>`。
- API 成功时关闭 sink；失败或取消时中止 sink。
- API 返回后不再写入 sink。调用方不得在任务运行期间复用同一个 sink。
- MP4 使用可顺序写入的 fragmented MP4。底层格式要求随机访问且无法顺序写入时，返回明确错误。

### 进度

- `renderCanvasToVideo()` 按已完成帧数报告进度，并报告最后一帧的结束时间。
- `trimVideo()` 报告归一化进度、已处理时长和总时长。
- `captureCanvasStream()` 是有开始和停止语义的实时会话，不提供离线任务进度。

## 各 API 的所有权

### `renderCanvasToVideo()`

- 调用方拥有 Canvas、`renderFrame()` 中使用的场景资源和可选 `AudioBuffer`。
- `@video-editor/media` 拥有任务期间创建的 `VideoFrame`、编码器和封装器。
- `renderFrame()` 完成后才捕获当前帧。回调失败时不会继续编码后续帧。

### `captureCanvasStream()`

- 调用方拥有 Canvas 和返回的 handle。
- `stop()` 负责停止视频轨道并关闭内部 writer，且可重复调用。
- handle 停止后调用 `requestFrame()`，返回名称为 `InvalidStateError` 的异常。

### `trimVideo()`

- 调用方拥有输入 `Blob` 或 URL。
- `@video-editor/media` 在任务结束前释放输入和转换器。
- 返回值报告实际请求范围、输出时长，以及视频轨和音频轨采用复制还是转码。

## 验收

- Chromium 中使用真实 Canvas 和 WebCodecs 生成含音视频轨的 MP4，并通过 `openMediaInput()`
  重新读取尺寸、时长和轨道信息。
- 对生成的音视频文件执行 `trimVideo()`，输出文件可以再次读取，且音视频轨均存在。
- HTMLCanvasElement 和 OffscreenCanvas 产生的视频轨分别通过本地 WebRTC loopback。
- 单元测试覆盖时间戳、末帧时长、取消、错误、sink 失败和资源释放。

OffscreenCanvas 从 Worker 向主线程转移视频轨仍需要单独的目标浏览器验收。在该测试通过前，
这一用法保持实验状态，不作为稳定兼容性承诺。
