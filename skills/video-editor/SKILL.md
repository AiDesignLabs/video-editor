---
name: video-editor
description: Build, integrate, or modify applications using this repository's video protocol, editor-core commands, timeline UI, renderer, and managed media APIs. Use for agent-authored timeline edits and video editor feature work; do not use for generic video processing outside this library.
---

# Video Editor

Use the public layer that owns the requested behavior. Keep this dependency direction:

```text
shared -> protocol -> editor-core -> renderer / ui -> application
```

## Required Boundaries

- Read the nearest `AGENTS.md` before editing a package.
- Treat the protocol as read-only application state. Mutate it only through `editor.commands`.
- Query `editor.selectors` and `canRun()` before constructing non-trivial edits.
- Use `editor.proposals.create()` for agent-generated edits that need human review. Accepting a proposal must remain one undo step.
- Use `MediaAssetCatalog` for normal media integration. Do not make application code manage OPFS files, proxy IDs, asset revisions, or PixiJS textures.
- Pass an `AbortSignal` to thumbnail and waveform requests when their UI or project can be replaced or destroyed.
- Do not import `AssetLibrary` from the package entry. It is internal to `protocol`; touch it only when the task explicitly changes storage, proxy generation, cache behavior, or asset diagnostics.
- Keep PixiJS objects inside the renderer. Protocol and editor-core code must not depend on PixiJS.
- Fail clearly when a required capability or dependency is missing. Do not add silent fallback behavior.

## Task Routing

- For editor commands, selectors, proposals, or managed media usage, read [public workflows](references/public-workflows.md).
- For asset identity, URL, OPFS, proxy, or PixiJS boundaries, read [media model](references/media-model.md).
- For roadmap implementation, read `docs/feature-roadmap.md` and the linked RFC before changing behavior.

## Verification

Run checks proportional to the changed packages. At minimum, run focused tests, `pnpm check`, changed-file ESLint, and `git diff --check`. Run `pnpm build` when public exports, package boundaries, renderer integration, or playground behavior changes.

Keep unrelated worktree changes untouched. Use the repository commit format `<type>(<scope>): <subject>` when a commit is requested.
