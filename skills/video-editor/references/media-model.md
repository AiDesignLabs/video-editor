# Media Model

## Concept ownership

| Concept               | Owner                        | Lifetime                         | Public use                                |
| --------------------- | ---------------------------- | -------------------------------- | ----------------------------------------- |
| `MediaAsset`          | `MediaAssetCatalog`          | Persistent                       | Display and select imported media         |
| `assetId`             | Protocol and asset catalog   | Persistent                       | Stable segment-to-media reference         |
| `SegmentAssetBinding` | Protocol compatibility layer | Persistent snapshot              | Spread into a new segment                 |
| URL                   | `AssetLibrary`               | May change                       | Do not construct in application code      |
| OPFS `File`           | Resource storage             | Browser-local                    | Advanced storage work only                |
| proxy derivation      | `AssetLibrary`               | Derived from one source revision | Advanced proxy work only                  |
| PixiJS `Texture`      | Renderer                     | Renderer instance                | Never store in protocol or asset metadata |

## Resolution path

```text
assetId
  -> MediaAsset record
  -> original or current preview version
  -> URL or OPFS File
  -> media decoder
  -> PixiJS Texture for visual media
```

Audio and export also consume resolved media, so asset identity must not depend on PixiJS Assets.
Renderer code may use PixiJS loading internally, but PixiJS keys are not asset IDs.

## Which API to use

Use `MediaAssetCatalog` for imports, lists, segment bindings, removal, and preview/export resolvers.
It hides URLs, revisions, proxy IDs, and OPFS details from normal integrations.

`AssetLibrary` is not a public package export. Use its source module only while implementing or debugging the
`protocol` package itself:

- custom persistent storage;
- proxy creation and source-revision tracking;
- URL relinking;
- derived-cache invalidation;
- raw OPFS file access.

When a source revision changes, an older proxy is stale and must not be used for preview. Export resolves
the original media even when a current proxy exists. Removing media requires all open and stored protocols
for reference checks; never pass an incomplete list to bypass deletion protection.
