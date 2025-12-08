# playground

这是一个用于测试的 playground 项目，给 packages 中的各个子包提供一个测试环境。

## 时间轴体验

- 默认挂载了 `@video-editor/ui` 的 `VideoEditorTimeline`，使用内置的 toolbar / ruler / playhead（主色 #222226）。
- 点击 +/- 仅放大刻度与片段宽度，播放器预览画布不会缩放；需要自定义可通过 slots 覆盖。
- 运行 `pnpm dev`（或 `pnpm -C playground dev`）启动本地预览。
