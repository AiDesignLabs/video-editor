<script setup lang="ts">
import type { CodecSupportProbe, EncodeProbeSettings, LabHints, LabProgress, LabResult, RenditionSpec, SourceInfo } from './transcode-lab'
import { computed, ref } from 'vue'
import { inspectSource, probeCodecSupport, runDecodeOnly, runEncodeOnly, runLab } from './transcode-lab'

defineOptions({ name: 'TranscodeLab' })

const PRESETS: RenditionSpec[] = [
  { id: 'proxy', label: 'proxy 360p', height: 360, videoBitrate: 600_000, keyFrameIntervalMs: 1000 },
  { id: 'preview', label: 'preview 720p', height: 720, videoBitrate: 2_500_000, keyFrameIntervalMs: 2000 },
]

type Mode = 'single' | 'both' | 'decode-only' | 'encode-only'

const file = ref<File | null>(null)
const source = ref<SourceInfo | null>(null)
const result = ref<LabResult | null>(null)
const error = ref<string | null>(null)
const running = ref(false)
const dragging = ref(false)
const progress = ref<LabProgress>({ framesDone: 0, framesTotal: 0, elapsedMs: 0 })

const mode = ref<Mode>('single')
const hints = ref<LabHints>({ hardwareAcceleration: 'no-preference', realtimeEncoding: false, previewFirst: false })
const support = ref<CodecSupportProbe | null>(null)
const encodeProbe = ref<EncodeProbeSettings>({ height: 720, videoBitrateKbps: 2500, keyFrameIntervalSec: 2, maxQueue: 4, framerate: 25 })
const targetHeight = ref(360)
const videoBitrateKbps = ref(600)
const keyFrameIntervalSec = ref(1)

/** What the run will produce: the manual single rendition, or both presets. */
const specs = computed<RenditionSpec[]>(() => (
  mode.value === 'both'
    ? PRESETS
    : [{
        id: 'custom',
        label: `${targetHeight.value}p`,
        height: targetHeight.value,
        videoBitrate: videoBitrateKbps.value * 1000,
        keyFrameIntervalMs: keyFrameIntervalSec.value * 1000,
      }]
))

let controller: AbortController | null = null

const copied = ref(false)

/**
 * Everything a reader needs to interpret a run, as plain data — so results can
 * be pasted instead of screenshotted. Blobs are left out; numbers are rounded
 * to what is meaningful.
 */
function buildReport() {
  const r = result.value
  if (!r)
    return null
  const round = (n: number, digits = 3) => Number(n.toFixed(digits))
  return {
    when: new Date().toISOString(),
    userAgent: navigator.userAgent,
    file: file.value ? { name: file.value.name, sizeBytes: file.value.size } : null,
    mode: mode.value,
    hints: { ...hints.value },
    renditions: mode.value === 'encode-only' ? null : specs.value.map(spec => ({ ...spec })),
    encodeProbeSettings: mode.value === 'encode-only' ? { ...encodeProbe.value } : null,
    support: support.value,
    source: {
      ...r.source,
      durationSec: round(r.source.durationSec, 2),
      fps: round(r.source.fps, 3),
      gopSec: r.source.gopSec === null ? null : round(r.source.gopSec, 3),
    },
    timing: {
      totalMs: round(r.timing.totalMs, 0),
      fps: round(r.timing.fps, 1),
      realtimeFactor: round(r.timing.realtimeFactor, 2),
    },
    heap: { peakBytes: r.heapPeakBytes, settledBytes: r.heapSettledBytes },
    outputs: r.outputs.map(o => ({
      id: o.spec.id,
      label: o.spec.label,
      requested: { height: o.spec.height, videoBitrate: o.spec.videoBitrate, keyFrameIntervalMs: o.spec.keyFrameIntervalMs },
      width: o.width,
      height: o.height,
      sizeBytes: o.sizeBytes,
      frameCount: o.frameCount,
      keyFrameCount: o.keyFrameCount,
      gopSec: o.gopSec === null ? null : round(o.gopSec, 3),
      encoderConfig: o.encoderConfig ?? null,
    })),
    encodeProbe: r.encodeProbe
      ? {
          ...r.encodeProbe,
          ms: round(r.encodeProbe.ms, 0),
          fps: round(r.encodeProbe.fps, 1),
          encodeWaitMs: round(r.encodeProbe.encodeWaitMs, 0),
          waitPerFrameMs: round(r.encodeProbe.waitPerFrameMs, 3),
        }
      : null,
  }
}

const reportJson = computed(() => {
  const report = buildReport()
  return report ? JSON.stringify(report, null, 2) : ''
})

async function copyReport() {
  const text = reportJson.value
  if (!text)
    return
  try {
    await navigator.clipboard.writeText(text)
  }
  catch {
    // Clipboard API can be denied; fall back to the selection-based copy.
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1500)
}

const percent = computed(() => {
  if (progress.value.ratio !== undefined)
    return progress.value.ratio * 100
  const { framesDone = 0, framesTotal = 0 } = progress.value
  return framesTotal > 0 ? Math.min(100, (framesDone / framesTotal) * 100) : 0
})

const etaLabel = computed(() => {
  const ratio = percent.value / 100
  if (!ratio)
    return '—'
  const remaining = (progress.value.elapsedMs / ratio * (1 - ratio)) / 1000
  return `${formatDuration(remaining)}`
})

function applyPreset(preset: RenditionSpec) {
  targetHeight.value = preset.height
  videoBitrateKbps.value = (preset.videoBitrate ?? 0) / 1000
  keyFrameIntervalSec.value = (preset.keyFrameIntervalMs ?? 2000) / 1000
}

function formatBytes(bytes: number) {
  if (bytes >= 1e9)
    return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6)
    return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e3).toFixed(0)} KB`
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds))
    return '—'
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m}分${String(s).padStart(2, '0')}秒` : `${s}秒`
}

function formatGop(gopSec: number | null) {
  return gopSec === null ? '—' : `${gopSec.toFixed(2)}s`
}

async function pickFile(next: File | null | undefined) {
  if (!next)
    return
  file.value = next
  source.value = null
  result.value = null
  error.value = null
  try {
    source.value = await inspectSource(next)
    support.value = await probeCodecSupport({ width: 1280, height: 720, bitrate: 2_500_000 })
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function handleDrop(event: DragEvent) {
  dragging.value = false
  void pickFile(event.dataTransfer?.files?.[0])
}

function handleInput(event: Event) {
  void pickFile((event.target as HTMLInputElement).files?.[0])
}

async function run() {
  const current = file.value
  if (!current || running.value)
    return

  running.value = true
  error.value = null
  result.value = null
  progress.value = { framesDone: 0, framesTotal: source.value?.frameCount ?? 0, elapsedMs: 0 }
  controller = new AbortController()

  try {
    const report = (next: typeof progress.value) => (progress.value = next)
    if (mode.value === 'decode-only')
      result.value = await runDecodeOnly(current, hints.value, report, controller.signal)
    else if (mode.value === 'encode-only')
      result.value = await runEncodeOnly(current, encodeProbe.value, hints.value, report, controller.signal)
    else
      result.value = await runLab(current, specs.value, hints.value, report, controller.signal)
  }
  catch (err) {
    if ((err as { name?: string }).name !== 'AbortError')
      error.value = err instanceof Error ? err.message : String(err)
  }
  finally {
    running.value = false
    controller = null
  }
}

function cancel() {
  controller?.abort()
}

function download(output: NonNullable<typeof result.value>['outputs'][number]) {
  const url = URL.createObjectURL(output.blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${file.value?.name.replace(/\.[^.]+$/, '') ?? 'output'}-${output.height}p.mp4`
  link.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <main class="lab">
    <header class="lab__header">
      <h1 class="lab__title">
        客户端转码实测
      </h1>
      <p class="lab__subtitle">
        测三件事：真实机器上的<strong>耗时</strong>、<strong>堆内存峰值</strong>，以及产出的
        <strong>GOP 是否真的变短了</strong> —— proxy 的全部意义就是快速 seek，
        继承了长 GOP 的 proxy 等于白转。
      </p>
    </header>

    <section
      class="drop" :class="{ 'drop--active': dragging }"
      @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="handleDrop"
    >
      <input id="lab-file" class="drop__input" type="file" accept="video/*" @change="handleInput">
      <label class="drop__label" for="lab-file">
        <span v-if="!file">把视频拖进来，或点击选择</span>
        <span v-else>{{ file.name }}（{{ formatBytes(file.size) }}）</span>
      </label>
    </section>

    <p v-if="error" class="lab__error">
      {{ error }}
    </p>

    <section v-if="source" class="panel">
      <h2 class="panel__title">
        源文件
      </h2>
      <dl class="grid">
        <div><dt>分辨率</dt><dd>{{ source.width }}×{{ source.height }}</dd></div>
        <div><dt>时长</dt><dd>{{ formatDuration(source.durationSec) }}</dd></div>
        <div><dt>帧率</dt><dd>{{ source.fps.toFixed(2) }} fps</dd></div>
        <div><dt>帧数</dt><dd>{{ source.frameCount.toLocaleString() }}</dd></div>
        <div><dt>编码</dt><dd>{{ source.codec ?? '—' }}</dd></div>
        <div>
          <dt>GOP</dt>
          <dd :class="{ 'is-bad': (source.gopSec ?? 0) > 3 }">
            {{ formatGop(source.gopSec) }}
          </dd>
        </div>
      </dl>
    </section>

    <section v-if="source" class="panel">
      <h2 class="panel__title">
        输出参数
      </h2>
      <div class="presets">
        <button
          class="btn" :class="{ 'btn--on': mode === 'single' }" type="button"
          @click="mode = 'single'"
        >
          单档（用下方参数）
        </button>
        <button
          class="btn" :class="{ 'btn--on': mode === 'both' }" type="button"
          @click="mode = 'both'"
        >
          双档：proxy 360p + preview 720p
        </button>
        <button
          class="btn" :class="{ 'btn--on': mode === 'decode-only' }" type="button"
          @click="mode = 'decode-only'"
        >
          仅解码（定位瓶颈）
        </button>
        <button
          class="btn" :class="{ 'btn--on': mode === 'encode-only' }" type="button"
          @click="mode = 'encode-only'"
        >
          仅编码 · 原生 WebCodecs（绕开 mediabunny）
        </button>
      </div>

      <div v-if="mode === 'encode-only'" class="fields">
        <label class="field"><span>目标高度 (px) · 等于源高度则直通</span><input v-model.number="encodeProbe.height" type="number" min="90" step="90"></label>
        <label class="field"><span>码率 (kbps)</span><input v-model.number="encodeProbe.videoBitrateKbps" type="number" min="100" step="100"></label>
        <label class="field"><span>关键帧间隔 (s)</span><input v-model.number="encodeProbe.keyFrameIntervalSec" type="number" min="0.5" step="0.5"></label>
        <label class="field"><span><strong>在途队列上限</strong>（mediabunny 固定 4）</span><input v-model.number="encodeProbe.maxQueue" type="number" min="1" step="1"></label>
        <label class="field"><span>framerate（Chrome 默认 30，源是 25）</span><input v-model.number="encodeProbe.framerate" type="number" min="1" step="1"></label>
      </div>

      <div class="hints">
        <label class="check">
          <span>hardwareAcceleration（解码器 + 编码器）</span>
          <select v-model="hints.hardwareAcceleration" class="select">
            <option value="no-preference">no-preference（默认）</option>
            <option value="prefer-hardware">prefer-hardware</option>
            <option value="prefer-software">prefer-software</option>
          </select>
        </label>
        <label class="check" :class="{ 'check--muted': mode === 'decode-only' }">
          <input v-model="hints.realtimeEncoding" type="checkbox" :disabled="mode !== 'encode-only'">
          <span>latencyMode: realtime（编码器，<strong>可能丢帧</strong>）</span>
        </label>
        <label class="check" :class="{ 'check--muted': mode !== 'both' }">
          <input v-model="hints.previewFirst" type="checkbox" :disabled="mode !== 'both'">
          <span>先生成 preview 720p</span>
        </label>
      </div>

      <div v-if="support" class="support">
        <span class="support__title">浏览器能力探测（avc 1280×720，isConfigSupported）</span>
        <table class="stages stages--compact">
          <thead><tr><th>hint</th><th>编码</th><th>解码</th></tr></thead>
          <tbody>
            <tr v-for="key in (['no-preference', 'prefer-hardware', 'prefer-software'] as const)" :key="key">
              <td>{{ key }}</td>
              <td :class="support.encode[key] ? 'is-good' : 'is-bad'">
                {{ support.encode[key] ? '支持' : '不支持' }}
              </td>
              <td :class="support.decode[key] ? 'is-good' : 'is-bad'">
                {{ support.decode[key] ? '支持' : '不支持' }}
              </td>
            </tr>
          </tbody>
        </table>
        <p class="note">
          浏览器不会说它选了哪个实现，但会说某个 hint 能不能满足 —— 如果 <code>prefer-software</code> 编码是「不支持」，
          那次跑的其实仍是硬编，两次 1.86 ms 相同就解释了。
        </p>
      </div>

      <div v-if="mode === 'single'" class="presets">
        <button v-for="preset in PRESETS" :key="preset.id" class="btn" type="button" @click="applyPreset(preset)">
          套用 {{ preset.label }}
        </button>
      </div>
      <div v-if="mode === 'single'" class="fields">
        <label class="field"><span>目标高度 (px)</span><input v-model.number="targetHeight" type="number" min="90" step="90"></label>
        <label class="field"><span>码率 (kbps)</span><input v-model.number="videoBitrateKbps" type="number" min="100" step="100"></label>
        <label class="field"><span>关键帧间隔 (s)</span><input v-model.number="keyFrameIntervalSec" type="number" min="0.5" step="0.5"></label>
      </div>
      <div class="actions">
        <button class="btn--primary btn" type="button" :disabled="running" @click="run">
          {{ running ? '转码中…' : '开始转码' }}
        </button>
        <button v-if="running" class="btn" type="button" @click="cancel">
          取消
        </button>
      </div>
    </section>

    <section v-if="running" class="panel">
      <div class="bar">
        <div class="bar__fill" :style="{ width: `${percent}%` }" />
      </div>
      <p class="progress-line">
        <template v-if="progress.ratio !== undefined">
          {{ percent.toFixed(1) }}% · {{ progress.renditionId }} ·
        </template>
        <template v-else>
          {{ progress.framesDone?.toLocaleString() }} / {{ progress.framesTotal?.toLocaleString() }} 帧 ·
        </template>
        已用 {{ formatDuration(progress.elapsedMs / 1000) }} · 预计还需 {{ etaLabel }}
      </p>
    </section>

    <section v-if="result" class="panel">
      <div class="panel__head">
        <h2 class="panel__title">
          结果 · 整体
        </h2>
        <button class="btn--primary btn" type="button" @click="copyReport">
          {{ copied ? '已复制 ✓' : '复制 JSON 结果' }}
        </button>
      </div>
      <dl class="grid">
        <div>
          <dt>总耗时</dt><dd class="is-key">
            {{ formatDuration(result.timing.totalMs / 1000) }}
          </dd>
        </div>
        <div>
          <dt>相对实时</dt>
          <dd :class="result.timing.realtimeFactor < 1 ? 'is-bad' : 'is-good'">
            {{ result.timing.realtimeFactor.toFixed(2) }}×
          </dd>
        </div>
        <div><dt>解码吞吐</dt><dd>{{ result.timing.fps.toFixed(1) }} fps</dd></div>
        <div>
          <dt>堆峰值</dt>
          <dd>{{ result.heapPeakBytes === null ? '不可用' : formatBytes(result.heapPeakBytes) }}</dd>
        </div>
        <div>
          <dt>堆结束值</dt>
          <dd>{{ result.heapSettledBytes === null ? '不可用' : formatBytes(result.heapSettledBytes) }}</dd>
        </div>
      </dl>
      <dl v-if="result.encodeProbe" class="grid">
        <div>
          <dt>等待编码器 · 每帧（原生）</dt>
          <dd class="is-key" :class="result.encodeProbe.waitPerFrameMs > 1 ? 'is-bad' : 'is-good'">
            {{ result.encodeProbe.waitPerFrameMs.toFixed(2) }} ms
          </dd>
        </div>
        <div><dt>等待编码器 · 累计</dt><dd>{{ formatDuration(result.encodeProbe.encodeWaitMs / 1000) }}</dd></div>
        <div><dt>在途上限</dt><dd>{{ result.encodeProbe.maxQueue }}</dd></div>
        <div>
          <dt>产出 chunk / 源帧</dt>
          <dd :class="result.encodeProbe.chunks < result.encodeProbe.frames ? 'is-bad' : 'is-good'">
            {{ result.encodeProbe.chunks.toLocaleString() }} / {{ result.encodeProbe.frames.toLocaleString() }}
          </dd>
        </div>
        <div><dt>喂帧方式</dt><dd>{{ result.encodeProbe.passthrough ? '直通解码帧' : 'canvas → VideoFrame' }}</dd></div>
        <div>
          <dt>实际 config</dt><dd class="cfg">
            {{ result.encodeProbe.config.codec }} · {{ result.encodeProbe.config.width }}×{{ result.encodeProbe.config.height }} · fr {{ result.encodeProbe.config.framerate ?? '默认' }} · {{ result.encodeProbe.config.hardwareAcceleration ?? 'no-preference' }} · {{ result.encodeProbe.config.latencyMode ?? 'quality' }}
          </dd>
        </div>
      </dl>
      <p class="note">
        「解码吞吐」是源帧的处理速率。
        <template v-if="result.encodeProbe">
          本次绕开了 mediabunny：同一套解码帧、同一种在途限制，直接进原生 <code>VideoEncoder.encode()</code>，没有封装器。
        </template>
        <template v-else-if="result.outputs.length === 0">
          本次是仅解码，没有产出。
        </template>
      </p>
      <details class="raw">
        <summary>查看 JSON</summary>
        <pre class="json">{{ reportJson }}</pre>
      </details>
    </section>

    <section v-for="output in result?.outputs ?? []" :key="output.spec.id" class="panel">
      <h2 class="panel__title">
        {{ output.spec.label }}
      </h2>
      <dl class="grid">
        <div>
          <dt>输出大小</dt><dd class="is-key">
            {{ formatBytes(output.sizeBytes) }}
          </dd>
        </div>
        <div>
          <dt>压缩比</dt>
          <dd>{{ (result!.source.sizeBytes / output.sizeBytes).toFixed(1) }}×</dd>
        </div>
        <div><dt>分辨率</dt><dd>{{ output.width }}×{{ output.height }}</dd></div>
        <div>
          <dt>输出帧数 / 源帧数</dt>
          <dd :class="output.frameCount < result!.source.frameCount ? 'is-bad' : 'is-good'">
            {{ output.frameCount.toLocaleString() }} / {{ result!.source.frameCount.toLocaleString() }}
          </dd>
        </div>
        <div><dt>关键帧数</dt><dd>{{ output.keyFrameCount.toLocaleString() }}</dd></div>
        <div v-if="output.encoderConfig">
          <dt>实际编码器配置</dt>
          <dd class="cfg">
            {{ output.encoderConfig.codec }} · {{ output.encoderConfig.hardwareAcceleration ?? 'no-preference' }} · {{ output.encoderConfig.latencyMode ?? 'quality' }}
          </dd>
        </div>
        <div>
          <dt>实测 GOP</dt>
          <dd
            class="is-key"
            :class="(output.gopSec ?? 0) > ((output.spec.keyFrameIntervalMs ?? 2000) / 1000) * 1.5 ? 'is-bad' : 'is-good'"
          >
            {{ formatGop(output.gopSec) }}
          </dd>
        </div>
        <div><dt>请求 GOP</dt><dd>{{ (output.spec.keyFrameIntervalMs ?? 2000) / 1000 }}s</dd></div>
      </dl>
      <div class="actions">
        <button class="btn" type="button" @click="download(output)">
          下载产出
        </button>
      </div>
    </section>

    <p v-if="result" class="note note--standalone">
      「实测 GOP」是把产出文件重新解析出来数关键帧算的，不是回显你填的设置 ——
      编码器不一定听话。产出是流式写进 OPFS 的，不经过 JS 堆。
      「堆峰值」是采样到的最高点，含未回收的垃圾；「堆结束值」是跑完静置后的读数，
      更接近真实常驻量 —— 两者差距大就说明峰值只是 GC 锯齿。两个数都只含 JS 堆，
      不含解码器和 GPU 显存。
    </p>
  </main>
</template>

<style scoped>
.lab {
  --at-apply: mx-auto max-w-3xl flex flex-col gap-4 p-6;
  color: var(--ink);
}

.lab__title {
  --at-apply: m-0 text-xl font-semibold;
}

.lab__subtitle {
  --at-apply: m-0 mt-2 text-sm leading-relaxed;
  color: var(--ink-muted);
}

.drop {
  --at-apply: rounded-2 border-2 border-dashed p-8 text-center transition-colors;
  border-color: var(--line);
  background: var(--panel);
}

.drop--active {
  border-color: var(--accent, #5a5aff);
}

.drop__input {
  --at-apply: hidden;
}

.drop__label {
  --at-apply: cursor-pointer text-sm;
}

.panel {
  --at-apply: flex flex-col gap-3 rounded-2 border p-4;
  border-color: var(--line);
  background: var(--panel);
}

.panel__title {
  --at-apply: m-0 text-sm font-semibold;
}

.grid {
  --at-apply: m-0 grid gap-3;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
}

.grid div {
  --at-apply: flex flex-col gap-1;
}

.grid dt {
  --at-apply: text-xs;
  color: var(--ink-muted);
}

.grid dd {
  --at-apply: m-0 text-sm font-mono;
}

.is-key {
  --at-apply: text-base font-semibold;
}

.is-good {
  color: #17803d;
}

.is-bad {
  color: var(--danger, #c02626);
}

.presets,
.actions,
.hints {
  --at-apply: flex flex-wrap gap-2;
}

.hints {
  --at-apply: gap-4;
}

.check {
  --at-apply: inline-flex items-center gap-1.5 text-xs cursor-pointer;
  color: var(--ink-muted);
}

.check--muted {
  --at-apply: opacity-50 cursor-not-allowed;
}

.support {
  --at-apply: flex flex-col gap-2;
}

.support__title {
  --at-apply: text-xs;
  color: var(--ink-muted);
}

.stages--compact {
  --at-apply: max-w-sm text-xs;
}

.cfg {
  --at-apply: text-xs break-all;
}

.hint {
  --at-apply: ml-1 text-xs font-normal;
  color: var(--ink-muted);
}

.panel__head {
  --at-apply: flex items-center justify-between gap-2;
}

.raw summary {
  --at-apply: cursor-pointer text-xs;
  color: var(--ink-muted);
}

.json {
  --at-apply: m-0 mt-2 max-h-72 overflow-auto rounded-1 p-2 text-xs font-mono whitespace-pre;
  border: 1px solid var(--line);
}

.select {
  --at-apply: rounded-1 border px-2 py-1 text-xs font-mono;
  border-color: var(--line);
  background: var(--bg, transparent);
  color: var(--ink);
}

.fields {
  --at-apply: grid gap-3;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
}

.field {
  --at-apply: flex flex-col gap-1 text-xs;
  color: var(--ink-muted);
}

.field input {
  --at-apply: rounded-1 border px-2 py-1 text-sm font-mono;
  border-color: var(--line);
  background: var(--bg, transparent);
  color: var(--ink);
}

.btn {
  --at-apply: cursor-pointer rounded-1 border px-3 py-1.5 text-sm;
  border-color: var(--line);
  background: transparent;
  color: var(--ink);
}

.btn:disabled {
  --at-apply: cursor-not-allowed opacity-50;
}

.btn--on {
  border-color: var(--accent, #5a5aff);
  color: var(--accent, #5a5aff);
}

.note--standalone {
  --at-apply: px-1;
}

.stages {
  --at-apply: w-full border-collapse text-sm;
}

.stages th {
  --at-apply: py-1 text-left text-xs font-normal;
  color: var(--ink-muted);
}

.stages td {
  --at-apply: py-1.5 font-mono;
  border-top: 1px solid var(--line);
}

.stages .is-top td {
  --at-apply: font-semibold;
}

.share {
  --at-apply: mr-2 inline-block h-2 w-24 overflow-hidden rounded-full align-middle;
  background: var(--line);
}

.share__fill {
  --at-apply: block h-full;
  background: var(--accent, #5a5aff);
}

.btn--primary {
  border-color: transparent;
  background: var(--accent, #5a5aff);
  color: #fff;
}

.bar {
  --at-apply: h-2 w-full overflow-hidden rounded-full;
  background: var(--line);
}

.bar__fill {
  --at-apply: h-full transition-all;
  background: var(--accent, #5a5aff);
}

.progress-line {
  --at-apply: m-0 text-xs font-mono;
  color: var(--ink-muted);
}

.note {
  --at-apply: m-0 text-xs leading-relaxed;
  color: var(--ink-muted);
}

.lab__error {
  --at-apply: m-0 rounded-1 p-3 text-sm;
  color: var(--danger, #c02626);
  background: color-mix(in srgb, var(--danger, #c02626) 8%, transparent);
}
</style>
