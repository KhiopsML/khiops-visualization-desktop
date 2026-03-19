const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');

module.exports = (config, options) => {
  // Default to 'web' - safe for browser/Cypress environments
  config.target = 'web';

  if (options.fileReplacements) {
    for (let fileReplacement of options.fileReplacements) {
      if (fileReplacement.replace !== 'src/environments/environment.ts') {
        continue;
      }

      let fileReplacementParts = fileReplacement['with'].split('.');
      // environment.web.ts      → parts: ['src/environments/environment', 'web', 'ts']
      // environment.electron.ts → parts: ['src/environments/environment', 'electron', 'ts']
      // environment.ts          → parts: ['src/environments/environment', 'ts']

      const envName = fileReplacementParts[fileReplacementParts.length - 2];

      // Only switch to electron-renderer for explicit electron environments
      if (['electron', 'electron-dev', 'electron-prod'].includes(envName)) {
        config.target = 'electron-renderer';
      } else {
        config.target = 'web';
      }

      break;
    }
  }

  // Only add NodePolyfillPlugin for web target — electron-renderer doesn't need polyfills
  if (config.target === 'web') {
    config.plugins = [
      ...config.plugins,
      new NodePolyfillPlugin({
        excludeAliases: ['console'],
      }),
    ];
  }

  // Fix for karma-webpack globalObject issue
  // https://github.com/ryanclark/karma-webpack/issues/497
  config.output.globalObject = 'globalThis';

  return config;
};
