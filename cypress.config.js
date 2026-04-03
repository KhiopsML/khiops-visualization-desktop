const { defineConfig } = require('cypress');
const webpackPreprocessor = require('@cypress/webpack-preprocessor');

module.exports = defineConfig({
  e2e: {
    baseUrl: 'http://localhost:4200',
    specPattern: 'cypress/e2e/**/*.cy.{js,ts}',
    supportFile: false,
    setupNodeEvents(on) {
      on(
        'file:preprocessor',
        webpackPreprocessor({
          webpackOptions: {
            module: {
              rules: [
                {
                  test: /\.ts$/,
                  loader: 'ts-loader',
                  options: { configFile: 'cypress/tsconfig.json' },
                },
              ],
            },
            resolve: { extensions: ['.ts', '.js'] },
          },
        }),
      );
    },
  },
});
