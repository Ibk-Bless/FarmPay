import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
const DEMO_PORT = 4174
const PAGES_PORT = 4175

// End-to-end tests run the real app in a browser with a fake Freighter wallet
// and a mocked API (see e2e/fixtures.ts), so no backend or testnet is needed.
// A second project runs the interactive demo build (e2e-demo/), which needs no mocks at all.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', testDir: './e2e', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'demo',
      testDir: './e2e-demo',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${DEMO_PORT}` },
    },
    {
      // The demo as GitHub Pages serves it: a production build under the /FarmPay/ sub-path.
      name: 'pages',
      testDir: './e2e-pages',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PAGES_PORT}/FarmPay/` },
    },
  ],
  webServer: [
    {
      command: `npm run dev -- --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npm run dev:demo -- --port ${DEMO_PORT} --strictPort`,
      url: `http://localhost:${DEMO_PORT}`,
      reuseExistingServer: !process.env.CI,
    },
    {
      // Built the same way as .github/workflows/pages.yml, then served like a static host would.
      // VITE_BASE must reach both steps, so it is set for the whole shell command.
      command: `VITE_BASE=/FarmPay/ sh -c 'npm run build:demo && npx vite preview --mode demo --port ${PAGES_PORT} --strictPort'`,
      url: `http://localhost:${PAGES_PORT}/FarmPay/`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
})
