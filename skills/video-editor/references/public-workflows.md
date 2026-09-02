# Public Workflows

## Create the editor

```ts
import { createEditorCore } from '@video-editor/editor-core'

const editor = createEditorCore({ protocol })
```

Read through `editor.state` and `editor.selectors`. Write through `editor.commands`; never assign into
`editor.state.protocol.value` or nested tracks and segments.

## Check and run a command

```ts
const check = editor.selectors.canRun({
  command: 'splitSegment',
  segmentId,
  timelineMs,
})

if (!check.ok)
  throw new Error(check.reason)

const result = editor.commands.splitSegment(segmentId, timelineMs)
if (!result.success)
  throw new Error('Split was refused')
```

Use batch commands such as `moveSegments`, `removeSegments`, `updateSegments`, and `duplicateSegments`
when several edits must share one undo step. Use `transaction()` only when no existing batch command
matches the operation.

## Create an agent proposal

```ts
const result = editor.proposals.create((draft) => {
  const split = draft.commands.splitSegment(segmentId, timelineMs)
  if (!split.success)
    throw new Error('Split was refused')
})

if (!result.success || !result.proposal)
  throw new Error(result.error ?? 'Proposal creation failed')
```

Show `proposal.operations`, `proposal.summary`, and `proposal.previewProtocol` for review. Call
`editor.proposals.accept(proposal.id)` only after approval. Rejecting a proposal must not call `undo()`.

## Import managed media

```ts
import { createMediaAssetCatalog } from '@video-editor/protocol'

const assets = createMediaAssetCatalog({
  getProtectedProtocols: () => [editor.commands.exportProtocol()],
})

const asset = await assets.import(file)
const binding = await assets.bindForSegment(asset.id)
```

Spread `binding` into the matching audio, image, or video segment input. The binding contains the
compatibility URL required by the current protocol; application code must not construct or rewrite it.

Use `assets.resolveForPreview` as the renderer resolver and `assets.resolveForExport` as the compose
resolver. Do not use the preview resolver for export.
