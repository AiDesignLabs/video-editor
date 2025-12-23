# Repository Guidelines

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a video editor project inspired by CapCut, built as a monorepo using pnpm workspaces. The architecture is modular with clear separation between protocol management, rendering, UI components, and shared utilities.

## Development Commands

### Setup
```bash
pnpm install  # Install dependencies (enforced via preinstall hook)
```

### Development
```bash
pnpm dev              # Start playground development server
pnpm -F playground dev  # Alternative explicit command
```

### Build
```bash
pnpm build            # Build all packages recursively
pnpm check            # Type check without emitting files
```

### Testing
```bash
pnpm test             # Run all tests across packages
pnpm test:protocol    # Run protocol tests with UI (vitest UI)
pnpm -C packages/protocol run test:ui  # Alternative protocol test command
```

Individual package tests:
```bash
pnpm -C packages/protocol test        # Run protocol tests headless
```

### Code Quality
```bash
pnpm lint             # Run ESLint with cache
pnpm lint:fix         # Auto-fix linting issues
```

### Other Commands
```bash
pnpm sizecheck        # Analyze bundle size with vite-bundle-visualizer
pnpm update:dependencies  # Update dependencies with taze
```

## Architecture

### Package Structure

The monorepo contains 6 main packages under `/packages/`:

- **@video-editor/protocol** - Core protocol management system
  - `manage/` - Protocol state management with undo/redo using Immer
  - `parse/` - Protocol parsing utilities
  - `resource/` - Resource management using OPFS (Origin Private File System)
  - `verify/` - JSON Schema validation using Ajv

- **@video-editor/renderer** - Video rendering engine

- **@video-editor/editor** - Main editor components (Vue-based)

- **@video-editor/ui** - Reusable UI components
  - Basic components: Button, Text

- **@video-editor/shared** - Shared types and utilities
  - `protocol.ts` - Core TypeScript interfaces for video protocol (IVideoProtocol, segments, tracks, etc.)

- **@video-editor/plugins** - Plugin system

### Core Concepts

#### Video Protocol (`IVideoProtocol`)

The protocol is the central data structure defined in `packages/shared/src/protocol.ts`:

- **Basic properties**: width, height, fps, version
- **Tracks**: Array of track objects containing segments
- **Track types**: frames, text, image, audio, effect, filter
- **Segments**: Time-based elements (startTime, endTime) within tracks

Key segment types:
- **Frames segments**: Video/image/3D frames with transforms, opacity, animations, transitions
- **Text segments**: Text content with styling, transforms, animations
- **Image segments**: Static images or GIFs
- **Audio segments**: Audio with volume, fade in/out, playback rate
- **Effect/Filter segments**: Visual effects and filters

#### Protocol Manager (`createVideoProtocolManager`)

Located in `packages/protocol/src/manage/index.ts`. Provides reactive state management:

- **State management**: Vue reactivity system (@vue/reactivity)
- **History**: Undo/redo functionality using Immer
- **Validation**: Real-time schema validation
- **Segment operations**: Add, remove, update segments with automatic track management
- **Transition management**: Add, remove, update transitions between frame segments
- **Time-based operations**: Segments are inserted based on current time (`curTime`)

Main API:
- `addSegment()` - Adds segment at current time, auto-creates tracks if needed
- `removeSegment()` - Removes segment and cleans up empty tracks
- `updateSegment()` - Updates segment with validation
- `addTransition()` - Creates transition between adjacent frame segments
- `undo()` / `redo()` - History navigation

#### Resource Manager (`createResourceManager`)

Located in `packages/protocol/src/resource/index.ts`. Manages media resources using OPFS:

- Stores resources in browser's Origin Private File System
- Default directory: `/video-editor-res`
- Operations: add, get, remove, clear
- Handles resource fetching and type detection

#### Validation System

Uses Ajv (JSON Schema validator) with plugins (ajv-errors, ajv-keywords, ajv-formats):

- Schema rules in `packages/protocol/src/verify/rules/`
- Validates protocol structure, segments, and tracks
- Enforces unique segment and track IDs
- Validates time ranges, numeric constraints, and required fields

## Important Notes

### Reactivity Dependency Hygiene

Packages that rely on Vue reactivity (`@video-editor/protocol`, `@video-editor/editor-core`, `@video-editor/renderer`) declare `@vue/reactivity` as a peer dependency to avoid bundling multiple reactivity runtimes.

Consumer guidance:
- Ensure a single `@vue/reactivity` instance in the app (pnpm dedupe or overrides).
- Externalize `@vue/reactivity` in library builds (Vite/Rollup `external`) to prevent bundling.
- If integrating outside Vue, bridge reactive state via snapshots/subscriptions instead of passing raw reactive objects to UI.

### Commit Message Convention

This project enforces conventional commits via git hook (`scripts/verifyCommit.mjs`):

Format: `<type>(<scope>): <subject>`

Allowed types: feat, fix, docs, dx, style, refactor, perf, test, workflow, build, ci, chore, types, wip, release

Examples:
- `feat(protocol): add transition support`
- `fix(renderer): handle edge cases in segment rendering`

### Git Hooks

- **pre-commit**: Runs lint-staged (ESLint auto-fix on all files)
- **commit-msg**: Validates commit message format
- **pre-push**: Runs all tests

### TypeScript Configuration

- Strict mode enabled
- Path aliases configured: `@video-editor/*` maps to `packages/*/src/index.ts`
- Custom types in `/types/` directory (e.g., mp4box.d.ts)

### Testing

- Uses Vitest with workspace configuration (`vitest.workspace.js`)
- Protocol package has extensive test coverage (`index.test.ts`)
- Browser testing available via @vitest/browser with Playwright

### Package Manager

- **pnpm only** - enforced via preinstall hook
- Workspace protocol for internal dependencies (`workspace:*`)
- Supports nested packages (up to 2 levels)
