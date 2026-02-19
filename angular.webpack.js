//Polyfill Node.js core modules in Webpack. This module is only needed for webpack 5+.
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');

/**
 * Custom angular webpack configuration
 */
module.exports = (config, options) => {
  // Default to 'web' target for browser environments (e.g., e2e tests)
  // Will be overridden to 'electron-renderer' if not using web environment
  config.target = 'web';

  if (options.fileReplacements) {
    for (let fileReplacement of options.fileReplacements) {
      if (fileReplacement.replace !== 'src/environments/environment.ts') {
        continue;
      }

      let fileReplacementParts = fileReplacement['with'].split('.');
      // Use electron-renderer target only when NOT using web environment
      if (
        fileReplacementParts.length > 1 &&
        ['web'].indexOf(fileReplacementParts[1]) >= 0
      ) {
        config.target = 'web';
      } else {
        // Only use electron-renderer for actual Electron builds (dev, prod environments)
        config.target = 'electron-renderer';
      }
      break;
    }
  }

  config.plugins = [
    ...config.plugins,
    new NodePolyfillPlugin({
      excludeAliases: ['console'],
    }),
  ];

  // https://github.com/ryanclark/karma-webpack/issues/497
  config.output.globalObject = 'globalThis';

  return config;
};
