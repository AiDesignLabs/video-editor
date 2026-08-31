// Starry loads this file from the workspace root.
//
// Starry's built-in AutoImport scans every file of every workspace package, so
// each symbol re-exported by a package `index.ts` is registered twice (once from
// its source file, once from the barrel). unplugin-auto-import then logs a
// "Duplicated imports" warning per symbol on every dev/build start.
//
// Nothing in this repo relies on auto-imported globals - playground and packages
// import everything explicitly - so the plugin is dropped entirely.
export default {
  build: {
    configureVite(config) {
      config.plugins = dropAutoImport(config.plugins)
      return config
    },
  },
}

function dropAutoImport(plugins) {
  if (!Array.isArray(plugins))
    return plugins
  return plugins
    .filter(plugin => plugin?.name !== 'unplugin-auto-import')
    .map(plugin => (Array.isArray(plugin) ? dropAutoImport(plugin) : plugin))
}
