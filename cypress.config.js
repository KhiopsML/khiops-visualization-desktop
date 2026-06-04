const { defineConfig } = require('cypress');
const fs = require('fs');
const path = require('path');

module.exports = defineConfig({
  e2e: {
    baseUrl: 'http://localhost:4200',
    specPattern: 'cypress/e2e/**/*.cy.{js,ts}',
    supportFile: false,
    setupNodeEvents(on) {
      on('task', {
        /**
         * Returns the path and content of a real (small) Khiops JSON fixture,
         * whose statSync will be mocked to 800 MB inside the browser test.
         * No large file is ever committed to git.
         */
        getLargeFileFixture() {
          const fixturePath = path.join(
            __dirname,
            '../visualization-component/src/assets/mocks/kv/C0_AllReports.json',
          );
          const content = fs.readFileSync(fixturePath, 'utf-8');
          return { path: fixturePath, content };
        },
      });
    },
  },
});
