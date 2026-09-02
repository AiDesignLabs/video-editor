# video editor

A CapCut-inspired video editor built as a monorepo with headless core architecture.

## Documentation

- [Feature Roadmap](./docs/feature-roadmap.md) - Current capabilities and planned editing features
- [Media Asset Public API](./docs/rfcs/0006-media-asset-public-api.md) - Stable media identity and storage boundaries
- [Agent Skill](./skills/video-editor/SKILL.md) - Safe command, proposal, and asset workflows for coding agents
- [Audio Waveform API](./WAVEFORM.md) - Extract and visualize audio waveforms
- [Architecture Guide](./CLAUDE.md) - Project structure and conventions

## Quick Links

- **Playground**: `pnpm dev` - Start the demo application
- **Protocol Package**: `packages/protocol` - State management and resources
- **UI Package**: `packages/ui` - Vue 3 timeline components
- **Renderer Package**: `packages/renderer` - Pixi.js rendering engine

## Features

- 🎬 Video timeline with drag-and-drop
- 🎵 Audio waveform visualization
- 🖼️ Video thumbnail generation
- ↩️ Undo/Redo support
- 💾 OPFS caching for offline-first performance
- 🎨 Pixi.js rendering with GPU acceleration
