# RFC 0002: Keyframe Curves (Protocol + Evaluator)

- Status: Draft
- Owner: Renderer Team
- Created: 2026-08-28
- Follows up: RFC 0001 §9.4 (`param = f(timelineMs)`) and §18.1 (curve schema)

## 1. Summary

Add an optional, per-segment keyframe track list to the protocol so segment
properties become time functions evaluated by the shared timeline evaluator.
v1 covers the visual properties `opacity`, `position.x`, `position.y`,
`scale`, `rotation`, the filter property `intensity`, and the audio property
`volume`.

Key decisions:

1. **Additive-optional schema, no protocol version bump.** `keyframes` is a
   new optional field on every segment type, mirroring how root-level
   `transitions` landed. v1 documents simply lack the field.
2. **Evaluation is pure.** `sampleKeyframes(track, relMs)` is a pure function
   of the segment-relative timeline time; preview and compose share it through
   the evaluator, guaranteeing identical results.
3. **Transform routes through the visual plan.** Today `transform` is read
   from the raw segment deep in the layout code; as a prerequisite it moves
   into `VisualPlanItem`/`VisualRenderItem`, matching how `opacity` already
   flows.

## 2. Schema

```ts
// packages/shared/src/protocol.ts
export type IKeyframeProperty
  = 'opacity' | 'position.x' | 'position.y' | 'scale' | 'rotation'
    | 'volume' | 'intensity'

export type IKeyframeEasing
  = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'
    | [number, number, number, number] // cubic-bezier control points

export interface IKeyframe {
  /** Timeline time relative to segment.startTime, in ms. */
  timeMs: number
  value: number
  /** Easing toward the NEXT keyframe. Defaults to 'linear'. */
  easing?: IKeyframeEasing
}

export interface IKeyframeTrack {
  property: IKeyframeProperty
  /** Sorted ascending by timeMs; ≥1 frame. */
  frames: IKeyframe[]
}

export interface ISegment<T> {
  // ...existing fields...
  keyframes?: IKeyframeTrack[]
}
```

Validation: a shared `commonKeyframesDefs` definition in
`verify/rules/commonDefs.ts`, `$ref`'d from **every** segment rule (Ajv
re-validates each edit; a missing `$ref` would silently roll back keyframe
edits on that segment type).

## 3. Semantics

1. **Time domain.** `timeMs` is timeline time relative to `segment.startTime`.
   It is NOT source time and is NOT multiplied by `playRate` — a keyframe at
   `timeMs: 1000` fires one second after the segment starts on screen.
2. **Out-of-range hold.** Before the first frame the first value holds; after
   the last frame the last value holds.
3. **Interpolation.** Between frames `k` and `k+1`, progress
   `t = (relMs - k.timeMs) / (k+1.timeMs - k.timeMs)` is shaped by
   `k.easing` (the outgoing edge), then values interpolate linearly:
   `value = k.value + (k+1.value - k.value) * ease(t)`.
   Named easings map to CSS cubic-bezier equivalents:
   `easeIn = (0.42, 0, 1, 1)`, `easeOut = (0, 0, 0.58, 1)`,
   `easeInOut = (0.42, 0, 0.58, 1)`.
4. **Base-value composition.** A keyframed property **replaces** the segment's
   static value while the segment is active. Properties not keyframed keep
   their static values.
   - `position.x`/`position.y` map to `transform.position[0]/[1]`
     (stage-normalized, [-1, 1] like `ITransform`).
   - `scale` applies uniformly to `transform.scale[0]` and `[1]`.
   - `rotation` maps to `transform.rotation[2]` in degrees.
5. **Volume composition.** The sampled volume curve replaces the static
   `volume`, then multiplies with the existing fade-in/fade-out envelope:
   `gain(relMs) = volumeCurve(relMs) × fadeEnvelope(relMs)`.
6. **Clamping.** After sampling, values clamp to the property's protocol
   range (`opacity`/`volume`/`intensity` to [0, 1]; positions to [-1, 1]).
7. **Split.** `splitSegment` rebases keyframes: the left half keeps frames
   with `timeMs < splitOffset`, the right half keeps the rest shifted by
   `-splitOffset`. Each half additionally gets a boundary keyframe sampled at
   the cut so the visual result is seamless.
8. **Preview/compose consistency.** Both paths sample through the shared
   evaluator (visuals) and the shared gain computation (audio), so exported
   video is bit-identical in intent to preview.

## 4. Out of scope (follow-ups)

1. Curve editor UI (v1 ships add/remove keyframe at playhead + timeline
   markers only).
2. Keyframes on effect parameters other than filter `intensity`.
3. Color/palette keyframes.
4. Spatial bezier paths (position curves are per-axis scalars).
