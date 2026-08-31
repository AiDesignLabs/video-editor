# Timeline design spec

Extracted from Figma `造境画布` → `预览-编辑权限` (file `JAE7VHxK97ptkzZroeUt4i`, node `17703-46896`)
via the Figma REST API on 2026-08-31. All values are 1x (the frame is 1920x1080).

The top `导航/登录` bar (1920x48) is intentionally **not** reproduced — per product, only the
workspace below it is in scope.

## Page

| Token                | Value                                            |
| -------------------- | ------------------------------------------------ |
| page background      | `#fafafc`                                        |
| stage card           | 1884x653, `#ffffff`, radius 12, 18px side margin |
| gap stage → timeline | 16px                                             |
| timeline card        | 1884x343, `#ffffff`, radius 8, 8px inner padding |

## Timeline toolbar

Single 24px-tall row inside a 46px band (≈11px vertical padding). Three groups laid out
left / center / right, `gap: 8px` inside each group.

| Element                     | Value                                          |
| --------------------------- | ---------------------------------------------- |
| icon button                 | 24x24, radius 4, icon 16x16                    |
| icon color (idle)           | `#222226` @ 35%                                |
| icon color (active/primary) | `#222226`                                      |
| divider                     | 1x16, `#000000` @ 12%, 8px gap either side     |
| save-status text            | Roboto 12/400, line-height 20, `#000000` @ 35% |
| time text                   | Roboto 14/500, line-height 22, `#000000` @ 90% |

Left group: add · `|` · delete · duplicate · locate · `|` · undo · redo · `|` · save + status text.
Center group: play · `00:00:00 / 00:03:00`.
Right group: prev-frame · next-frame · `|` · zoom-out · slider · zoom-in · volume.

### Zoom slider

| Element | Value                                                          |
| ------- | -------------------------------------------------------------- |
| track   | 160x4, `#222226` @ 12%, radius 2                               |
| fill    | `#222226`, radius 2                                            |
| knob    | 16x16 circle, `#ffffff` fill, `#222226` stroke, stroke-width 3 |

## Ruler

| Element         | Value                                                        |
| --------------- | ------------------------------------------------------------ |
| label           | Roboto 8/400, `#5a5a5a`, left-aligned just right of its tick |
| major tick      | 8px tall, one every 2s                                       |
| minor tick      | 4px tall                                                     |
| scale at zoom 1 | 90px per 2s → 45px/s                                         |

## Playhead

| Element | Value                                                                               |
| ------- | ----------------------------------------------------------------------------------- |
| head    | 8x15, `#ffffff` fill, `#222226` 1px stroke, radius 2 (capsule tapering to the line) |
| line    | 1px wide, `#222226`, 289px tall (ruler + all tracks)                                |

## Track rail

A 24px-wide sticky column left of the tracks, 2px gap to the track body.

| Element | Value                                                                |
| ------- | -------------------------------------------------------------------- |
| cell    | 24 x trackHeight, `#000000` @ 5%, radius 4                           |
| icon    | 12x12, `#000000` @ 35% (circled play for frames, waveform for audio) |

## Tracks

| Element                             | Value                                                              |
| ----------------------------------- | ------------------------------------------------------------------ |
| row height                          | 56px (every track type; `trackHeightByType` can override per type) |
| row gap                             | 2px                                                                |
| row background                      | `#fafafa`                                                          |
| row background (main / highlighted) | `#f4f4f6`                                                          |

### Segments

| Element              | Value                                                                   |
| -------------------- | ----------------------------------------------------------------------- |
| radius               | 4px                                                                     |
| frames background    | `#222226`                                                               |
| audio background     | `#efefef`                                                               |
| thumbnail tile       | 56x56, tiled left→right                                                 |
| video waveform strip | 12px tall, pinned to the segment's bottom edge                          |
| label chip           | height 16, `#000000` @ 25%, radius 4, 4px inset from the segment corner |
| label text           | white @ 90%                                                             |

### Add button (end of a track)

40x40, `#f2f2fa`, radius 8, icon 16x16 `#222226`.

---

## 与 canvas-fe-design-spec 的对账（2026-08-31）

`creatly-fe2/skills/canvas-fe-design-spec/references/design-rules.md` 是造境画布的规范页，
优先级高于本文件记录的「预览-编辑权限」应用稿。对账结果：

### 必须替换的废弃色

预览稿里取到的这三个值都在规范的 Deprecated 名单上，已换成透明度叠加：

| 预览稿取值 | 用途                 | 换成                                                           |
| ---------- | -------------------- | -------------------------------------------------------------- |
| `#F2F2FA`  | 轨道末尾的新增按钮底 | 透明底 + `#000` 12% 描边（「添加/上传按钮」规范）              |
| `#EFEFEF`  | 音频片段底           | `#000` 5% 叠加                                                 |
| `#F4F4F6`  | 主轨道行底           | `#000` 5% 叠加（等效纯色 `#F2F2F2`，色差 2，在规范允许范围内） |

`#222226`（主按钮底）和 `#5A5AFF`（选中描边）规范里仍然沿用，保留。

### 两处规范与预览稿不一致，取规范

| 项                | 预览稿 | 规范                                | 采用     |
| ----------------- | ------ | ----------------------------------- | -------- |
| 24px 图标按钮圆角 | 4px    | 「按钮圆角按高度决定 … 24px → 6px」 | **6px**  |
| 标尺刻度字号      | 8px    | 字号档位最小 `10/16`                | **10px** |

### 主题

规范要求亮/暗双主题，且「只实现亮色视为未完成」。亮色黑色叠加 ↔ 暗色白色叠加，
透明度数值两侧相同。几何量（字号、圆角、间距、尺寸）两主题完全一致。

因此本文件上半部分记录的**几何值全部有效**，而所有**颜色值**以 `packages/ui/src/theme.css`
里的成对 token 为准，不再直接引用预览稿的十六进制。

---

## 滤镜 / 特效设计器（新增，无现成设计稿）

Figma 上没有 filter/effect 编辑面板的节点（`figma-links.md` 里也没有登记），所以这个面板是
**按规范推导出来的**，不是照着稿子画的。用的是 design-rules.md 的「画布限定（节点编辑面板）」条目：

| 元素       | 规范值                                                       |
| ---------- | ------------------------------------------------------------ |
| 面板       | 圆角 12px，padding 16px，分组间距 12px，常规阴影，0.5px 描边 |
| 分组标题   | 14px Medium，次要色（55%）                                   |
| 选项       | 高 32px、圆角 8px、padding 0 8px、文字 12px 居中             |
| 选项选中态 | 亮色 `#F0F0F0` / 暗色 `#FFF` 12%，均叠 `inset 0 0 0 1px` 8%  |
| 选项未选中 | 透明；hover 叠 5%                                            |

组件：`packages/ui/src/PropertyInspector/sections/EffectSection.vue`，filter 和 effect 共用，
filter 多一条强度滑杆。

**预设列表由宿主注入**（`filter-presets` / `effect-presets`），因为 `packages/ui` 不能依赖
`@video-editor/renderer`（二者是同级包）。playground 传的是 renderer 的
`listEffectDefinitions()`，过滤掉 `legacy:` 前缀的兜底定义。

段上带着宿主不认识的 `filterId` / `effectId` 时（预设被删、或别的编辑器写入的），面板会把它作为
一个额外选项显示出来并标「未注册」，而不是静默地什么都不选中。

---

## 与业务实现对账（2026-08-31，第二轮）

设计稿难读，改为直接对齐**已上线的实现**。真实取值来源：

- `creatly-fe2/apps/ailsc-global/app/assets/css/theme.css` —— `--ct-*` 的 `:root` / `html.dark` 两套值
- `creatly-fe2/packages/video-editor-ui/src/style.css` —— 组件样式怎么消费这些 token
- `creatly-fe2/.../preview-workspace/components/VideoTracks.vue` —— 真正上线的工具栏和 35 条 `:deep()` 覆盖

`packages/ui/src/theme.css` 的颜色值全部改成从这里取，并在注释里标了对应的 `--ct-*` 名字，方便机械核对。

### 与 Figma 应用稿不一致，取实现

| 项                       | Figma 稿                     | 上线实现                                   | 采用                        |
| ------------------------ | ---------------------------- | ------------------------------------------ | --------------------------- |
| 工具栏按钮图标色（常态） | `#222226` 35%                | `--ct-content-primary` 全色                | **全色**                    |
| 按钮圆角                 | 4px（稿）/ 6px（规范按高度） | Uno `rounded` = 4px                        | **4px**                     |
| 工具栏高度               | 46px                         | `--video-tracks-toolbar-height: 33px`      | **33px**                    |
| 标尺字号                 | 8px（稿）/ 10px（规范档位）  | 11px                                       | **10px** —— 见文末裁定      |
| 轨道行底                 | `#fafafa`                    | `--ct-surface-control-subtle` = `#f5f5f5`  | **实现**                    |
| 主轨行底                 | `#f4f4f6`                    | `--ct-surface-control-muted` = `#f1f1f1`   | **实现**                    |
| 音频片段底               | `#efefef`（已废弃色）        | `--ct-surface-control-muted`               | **实现**                    |
| 轨道选中                 | 稿中无                       | `--ct-accent-selection-soft` 4% / 暗 16%   | **实现**                    |
| 视频段内波形条高         | 12px                         | 16px                                       | **16px**                    |
| 标签 chip                | 内缩 4px、高 16              | 内缩 6/8px + `scale(0.9)`                  | **实现**                    |
| 分隔线                   | `#000` 12%                   | `--ct-border-subtle` `#e4e4e4` / `#3b3b3b` | **实现**                    |
| 暗色一级表面             | `#1a1a1a`（规范页）          | `--ct-surface-elevated` = `#222222`        | **`#222222`** —— 见文末裁定 |

### 业务侧那 35 条 `:deep()` 现在可以删掉

`VideoTracks.vue` 目前要写 35 条 `:deep(.video-editor-timeline …)` 才能把包重新上色，
其中一条还得用 `!important`。现在每一条都有对应 token，整块可以塌成一个变量声明：

```less
:deep(.video-editor-timeline .ve-timeline) {
  --ve-surface-elevated: var(--ct-surface-elevated);
  --ve-content-primary: var(--ct-content-primary);
  --ve-content-secondary: var(--ct-content-secondary);
  --ve-ruler-background: var(--ct-surface-elevated);
  --ve-ruler-border: var(--ct-border-card-weak);
  --ve-ruler-tick-color: var(--ct-border-subtle);
  --ve-ruler-tick-major-color: var(--ct-content-tertiary);
  --ve-playhead-color: var(--ct-content-primary);
  --ve-track-background: var(--ct-surface-control-subtle);
  --ve-track-main-background: var(--ct-surface-control-muted);
  --ve-track-selected-background: var(--ct-accent-selection-soft);
  --ve-track-selected-border: var(--ct-accent-selection-border);
  --ve-segment-handle-color: var(--ct-action-primary);
  --ve-segment-handle-dot-color: var(--ct-content-on-primary);
  --ve-segment-audio-background: var(--ct-surface-control-muted);
  --ve-segment-video-background: var(--ct-surface-control-muted);
  --ve-segment-waveform-strip-background: var(--ct-surface-control-muted);
  --ve-segment-placeholder-background: var(--ct-surface-control-hover);
  --ve-segment-placeholder-color: var(--ct-content-secondary);
  --ve-segment-base-background: var(--ct-surface-control-hover);
  --ve-segment-pill-background: var(--ct-surface-selected);
  --ve-segment-label-background: var(--ct-overlay-scrim);
  --ve-overlay-scrim-strong: var(--ct-overlay-scrim-strong);
  --ve-waveform-color: var(--ct-progress-fill);
  --ve-border-weak: var(--ct-border-card-weak);
  /* 这七个业务已经在用，名字保持不变 */
  --ve-primary: var(--ct-content-primary);
  --ve-track-rail-width: var(--video-tracks-rail-width, 24px);
  --ve-track-add-button-background: var(--ct-surface-elevated);
  --ve-track-add-button-border: var(--ct-border-card-weak);
  --ve-track-add-button-color: var(--ct-content-primary);
  --ve-track-add-button-hover-background: var(--ct-surface-control-hover);
  --ve-track-gap-add-icon-background: var(--ct-action-primary);
  --ve-track-gap-add-icon-color: var(--ct-content-on-primary);
}
```

上游的默认值已经等于业务当前的取值，所以**大部分行其实也可以不写** —— 只有业务想偏离默认时才需要。

### 两处冲突的裁定（2026-08-31，产品确认）

规范页和上线实现在这两项上不一致，取值已由产品拍板，不再按"哪个来源优先"的通则推导：

| 项           | 规范页           | 上线实现  | **采用**                |
| ------------ | ---------------- | --------- | ----------------------- |
| 暗色一级表面 | `#1A1A1A`        | `#222222` | **`#222222`**（跟实现） |
| 标尺字号     | 10px（档位下限） | 11px      | **10px**（跟规范）      |

两项各跟了一边。后续再动 `--ve-surface-elevated` 或 `--ve-ruler-font-size` 之前先看这张表，
别再用"实现优先"或"规范优先"的单一规则去重推。

### 轨道行高（2026-08-31，产品确认）

Figma 稿里 frames 行 56px、audio 行 48px，一度按稿实现过。产品确认**统一 56px**，不要混高。

`VideoTimeline` 的 `trackHeightByType` prop 保留（默认空），逐轨道高度的布局能力也保留在
`VideoTimeline/metrics.ts` —— 一旦有人打开这个开关，拖拽命中、拖拽预览、resize 预览、转场接缝
都还是对的。`metrics.test.ts` 里锁死混合高度行为的用例继续保留，防止以后有人"顺手"把布局
改回 `index * (height + gap)` 的等高假设。

---

## text / sticker / effect / filter 片段样式（暂无设计稿，按既有约定推导）

设计稿只画了 frames 和 audio。这四类是「没有媒体内容可展示」的片段，统一成一套语言：

| 元素         | 值                                            | token                           |
| ------------ | --------------------------------------------- | ------------------------------- |
| 底色         | `#000` 5% 叠加（和 audio 同族的中性面）       | `--ve-segment-meta-background`  |
| 描边         | 0.5px inset                                   | `--ve-segment-meta-border`      |
| 圆角         | 4px                                           | `--ve-segment-radius`           |
| 左侧类型色条 | 3px，轨道 accent 色                           | `--ve-segment-accent-bar-width` |
| 图标         | 12px，accent 色                               | `--ve-segment-meta-icon-size`   |
| 文案         | 11px 次要色；文本片段的内容预览用 12px 主要色 | —                               |

依据的三条既有约定：

1. **面用中性叠加，不用饱和色填充** —— 上线实现里颜色来自媒体（缩略图/波形），chrome 一律中性。
   之前这四类用的是 accent 40% 透明填充，暗色下非常刺眼。
2. **类型识别靠细节而非整块着色** —— 3px 色条 + 图标，一眼能分辨，又不会盖过相邻的视频轨。
3. **全部走 token** —— 亮暗自动成立，业务可单点覆盖。

图标取自 `@creatly/figma-icons`（catalog 锁的 0.0.3-beta.1，391 个）：
text→`text`、sticker→`element`、effect→`star`、filter→`brush`。没有引入新图标包。

顺带修掉一个存量缺陷：`SegmentBase` 原来并排渲染 `trackType` 和 `segmentType` 两个 pill，
而这两个值对这些类型是**同一个字符串**，所以界面上一直显示成 `filter filter` / `effect effect`。
现在优先显示 `extra.label` → `name` → `segmentType`，实际渲染成「冷色调」「模糊」。

**同时移除了所有类型的 segment 表面着色**（`SEGMENT_SURFACE = 'transparent'`）—— 每个片段组件
现在都自己画 token 驱动的底色，外层再叠一层 accent 只会透上来污染这些面。轨道身份改走
`--ve-segment-accent`，由组件用在色条和图标上。

设计稿出来后，这一节整体替换即可，token 名可以保留。
