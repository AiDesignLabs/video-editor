# RFC 0003: Speed Curves (Variable-Rate Source Mapping)

- Status: Draft
- Owner: Renderer Team
- Created: 2026-08-28
- Follows up: RFC 0002 (keyframe tracks), and the shared `mapSourceTimeMs`
  helper in `packages/shared/src/timing.ts`

## 1. Summary

Today a media segment plays at one constant `playRate`, so timeline time maps
onto source time with a single multiplication. This RFC proposes `speed` as a
new `IKeyframeProperty`, turning the play rate into a time function and the
source mapping into the **cumulative integral** of that function.

Key decisions:

1. **`speed` is a keyframe track, not a new segment field.** It reuses the
   RFC 0002 schema (`{ property: 'speed', frames: [...] }`), so no protocol
   version bump and no new editing surface concepts.
2. **One shared closed form.** `mapSourceTimeMs` in
   `packages/shared/src/timing.ts` remains the single mapping entry point; it
   grows a curved branch computed piecewise-analytically (no numeric
   integration at render time).
3. **Curved segments are decoder/buffer-only.** The `<video>`/`<audio>`
   element paths cannot follow a rate curve accurately and are abandoned for
   such segments, exactly as `reversed` already does.
4. **Split and resize become curve re-slicing**, not scalar arithmetic.

## 2. Motivation

- Speed ramps (slow-mo in, snap back to 1x) are table stakes in CapCut-style
  editors; a constant `playRate` cannot express them.
- The current constant-rate assumption is duplicated across eight call sites.
  Adding ramps ad-hoc would re-fragment the mapping that P8 just unified.
- `reversed` (also landed in P8) is a special case of a signed rate curve;
  a curve model gives both a common home.

## 3. Schema

```ts
// packages/shared/src/protocol.ts
export type IKeyframeProperty
  = 'opacity' | 'position.x' | 'position.y' | 'scale' | 'rotation'
    | 'volume' | 'intensity'
    | 'speed' // NEW: rate multiplier, range [0.1, 100]
```

- Frames are `{ timeMs, value, easing? }` with `timeMs` relative to
  `segment.startTime`, as in RFC 0002.
- `value` is a rate multiplier clamped to the existing `[0.1, 100]` range
  (`normalizePlayRate`). It never reaches 0: a zero rate is a freeze frame and
  is deliberately out of scope for v1.
- When a `speed` track is present it **replaces** the static `playRate`;
  segments without one behave exactly as today.
- `reversed` stays a separate boolean flag (see §8), not a negative rate.

## 4. Source mapping: cumulative integral

For a constant rate the mapping is `sourceMs = fromTime + relMs * rate`.
With a rate curve `r(t)` it becomes:

```
sourceMs(relMs) = fromTime + ∫₀^relMs r(t) dt
```

Because RFC 0002 keyframes interpolate **piecewise** between frames, the
integral has a closed form per span and never needs sampling:

- **Linear easing** on span `[t₀, t₁]` with rates `r₀ → r₁`: the integral over
  the whole span is the trapezoid `(r₀ + r₁) / 2 * (t₁ - t₀)`; a partial span
  up to `t` is `r₀ * dt + (r₁ - r₀) * dt² / (2 * (t₁ - t₀))` where
  `dt = t - t₀`.
- **Cubic-bezier easing**: integrate the easing polynomial analytically per
  span (a fixed quartic in the bezier parameter), or fall back to a fixed
  16-step Simpson rule per span — still O(1) per span and deterministic, so
  preview and compose stay identical.
- **Before the first / after the last frame**: the rate is held constant
  (flat extrapolation), matching RFC 0002's sampling rule.

**Prefix sums.** Per-span integrals are constant for a given curve, so the
evaluator precomputes a prefix-sum table once per segment (invalidated by the
segment's keyframe identity) and each `mapSourceTimeMs` call is a binary
search plus one closed-form partial span. This keeps the mapping pure and
allocation-free on the hot path.

**Span length.** `sourceSpanMs(segment)` becomes the full integral over
`[0, endTime - startTime]` instead of `duration * rate`. All existing callers
already go through this helper, so they inherit the curved behavior.

## 5. Inventory: the eight linear-assumption sites

Every place that currently assumes `sourceMs` is linear in timeline time and
must be revisited:

| # | Site | Assumption today |
|---|------|------------------|
| 1 | `renderer/src/timeline/evaluator.ts` | `mapRemappableSourceTimeMs` → shared `mapSourceTimeMs`; emits a **scalar** `rate` on audio plan events |
| 2 | `renderer/src/timeline/visual-plan.ts` | `mapTransitionTargetSourceTimeMs` maps the transition B-side through the same shared helper |
| 3 | `renderer/src/audio-manager.ts` | Scalar `rate` events set `AudioBufferSourceNode.playbackRate.value` / `el.playbackRate`; drift tracking (`currentDecodedBufferOffsetSec`) assumes a constant rate since `startCtxTime` |
| 4 | `renderer/src/compose.ts` | `decodeInputAudioSlice` decodes `[fromTime, fromTime + sourceSpanMs]` and plays it back at one `source.playbackRate.value` |
| 5 | `renderer/src/renderer-core.ts` | `updateVideoElementFrame({ playbackRate })` drives the `<video>` element at a single rate |
| 6 | `protocol/src/manage/index.ts` — `resizeSegment` | Start-edge remap `fromTime += delta * rate`, and the extend-left clamp `-fromTime / rate` |
| 7 | `protocol/src/manage/index.ts` — `splitSegment` | `right.fromTime = fromTime + cutRel * rate` (plus the mirrored reversed branch) |
| 8 | `ui/src/VideoEditorTimeline/segments/FramesSegment.vue` | Thumbnail strip computes `sourceSpanMs = duration * playRate` and spaces bars uniformly across it |

Sites 1, 2, 4, 6, 7 are fixed by routing through the curved
`mapSourceTimeMs`/`sourceSpanMs`. Sites 3, 5, 8 need real design work (§6, §7).

## 6. Audio strategies

The audio path is the hard part: a curve must be applied to a sample stream,
not just to a seek position.

| Strategy | How | Pros | Cons |
|----------|-----|------|------|
| **A. `playbackRate.setValueCurveAtTime`** | Decode the full source window once, then schedule the rate curve on the live `AudioBufferSourceNode` | Cheap; no extra decode; works while scrubbing | Browser resampling quality varies; the curve must be re-scheduled on every seek; the node's playhead is not directly readable, so drift tracking must integrate the curve too |
| **B. Offline resampling** | Render the curved segment once through an `OfflineAudioContext` (or a WSOLA/phase-vocoder pass) into a straight buffer, then play it at rate 1 | Exact, identical in preview and export; enables pitch-preserving time-stretch later | Up-front cost per curve edit; needs an invalidation cache keyed by the curve |
| **C. `<audio>` element** | `el.playbackRate` stepped per frame | — | Rejected: stepping the rate produces audible zipper artifacts and the element's own clock drifts; **the element path must be abandoned for curved segments**, mirroring `reversed` |

**Proposal:** strategy **A** for preview (responsive to edits) and strategy
**B** for compose (exactness), with the preview→compose consistency test
extended to assert the two agree within a tolerance at sampled times. If A's
drift proves unacceptable, preview falls back to B behind the existing
video-buffer voice cache.

## 7. Split, resize, and inverse mapping

**Split.** A cut at `timelineMs` splits the curve, not a scalar:

- Left half keeps frames with `timeMs < cutRel` plus a boundary frame sampled
  at `cutRel` (same rule as RFC 0002 §3.7).
- Right half keeps the remaining frames shifted by `-cutRel`, plus its own
  boundary frame at 0.
- `right.fromTime = mapSourceTimeMs(left, timelineMs)` — the integral up to
  the cut, which reduces to today's `fromTime + cutRel * rate` for a constant
  curve, so the existing tests keep passing.

**Resize.** Start-edge trimming consumes `∫` over the trimmed prefix rather
than `delta * rate`, and the curve must be re-anchored (frames shifted by
`-delta`, boundary frame inserted). The extend-left clamp
`delta ≥ -fromTime / rate` becomes "the largest `delta` whose integral does
not exceed `fromTime`" — solvable in closed form per span by walking spans
backwards.

**Inverse mapping.** UI surfaces need `timelineMs = f⁻¹(sourceMs)`:

- The thumbnail strip (site 8) places bars at uniform *source* offsets and
  must convert them to timeline x-positions.
- The resize clamp above is literally an inverse lookup.

`r(t) > 0` for all `t` (rates are clamped to `[0.1, 100]`), so the integral is
strictly increasing and the inverse is well defined. It is computed with the
same prefix-sum table: binary search for the span, then solve the span's
closed form (a quadratic for linear easing). Proposed API:

```ts
export function mapTimelineTimeMs(segment: SourceTimedSegment, sourceMs: number): number
```

## 8. Interaction with `reversed`

`reversed` mirrors the source window: `sourceMs = fromTime + (span - ∫)`.
With a curve the same identity holds once `span` is the full integral, so the
reversed branch in `mapSourceTimeMs` needs no special casing beyond using the
curved `sourceSpanMs`. Semantics to preserve:

- The curve is expressed in **timeline** time, so a ramp at the start of a
  reversed segment slows down the *end* of the source window. This is the
  intuitive editing behavior (the ramp is where the user drew it on the
  timeline).
- Reversed + curved segments are decoder/offline-only on both paths, which is
  already true for `reversed` alone.
- The reversed split re-slicing rule (left half takes the window tail) applies
  unchanged, with `span` replaced by the integral.

Reversed plain-audio segments already use the same decoded-buffer preview path
as reversed video audio. Curved audio can extend that path with the scheduling
strategy selected in §6.

## 9. v1 scope proposal

1. `speed` keyframe track in the protocol + Ajv rules, clamped to
   `[0.1, 100]`.
2. Curved `mapSourceTimeMs` / `sourceSpanMs` / new `mapTimelineTimeMs` in
   `packages/shared/src/timing.ts`, with prefix-sum caching.
3. Evaluator emits the instantaneous rate at `atMs` (so existing scalar
   consumers degrade gracefully) plus the curve reference for the audio path.
4. Audio: strategy A in preview, strategy B in compose; curved segments never
   use the element path.
5. Video: decoder path only for curved segments; the element path renders a
   placeholder if the decoder is unavailable.
6. Protocol: split/resize curve re-slicing with the boundary-frame rule.
7. UI: thumbnail strip and resize clamp use `mapTimelineTimeMs`; a minimal
   speed-ramp editor (add/remove speed keyframe at the playhead).

## 10. Out of scope (follow-ups)

1. Pitch-preserving time stretch (v1 lets pitch follow the rate).
2. Freeze frames (`rate == 0`) and negative rates as a curve value; `reversed`
   stays a boolean flag.
3. Optical-flow / frame-interpolated slow motion.
4. Speed curves on non-media segments (text, sticker, effect).
5. A full graphical curve editor (RFC 0002 §4.1 already defers this).
