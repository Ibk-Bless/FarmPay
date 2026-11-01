import { expect, test, type Page } from '@playwright/test'

// The demo as GitHub Pages will serve it: built with VITE_BASE=/FarmPay/ and hosted under that
// sub-path. A wrong asset path here means a blank page that every other test would miss, because
// they all run the dev server at the site root.

// A project page is addressed relative to its base, so these go to /FarmPay/ and not to /.
const open = (page: Page, hash = '') => page.goto(`./${hash}`)

test('the demo loads under the sub-path with every asset found', async ({ page }) => {
  const problems: string[] = []
  page.on('requestfailed', (request) => problems.push(`failed: ${request.url()}`))
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`${response.status()}: ${response.url()}`)
  })

  await open(page)
  await expect(page.getByRole('heading', { name: /Guaranteed payment for farm deliveries/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Demo controls' })).toBeVisible()
  await page.waitForLoadState('networkidle')

  expect(problems, `Requests that failed:\n${problems.join('\n')}`).toEqual([])
})

test('scripts, styles and the icon are all served from under the sub-path', async ({ page }) => {
  const assets: string[] = []
  page.on('response', (response) => {
    if (['script', 'stylesheet', 'image'].includes(response.request().resourceType())) assets.push(response.url())
  })

  await open(page)
  await page.waitForLoadState('networkidle')

  expect(assets.length).toBeGreaterThan(0)
  for (const url of assets) expect(new URL(url).pathname, url).toMatch(/^\/FarmPay\//)
})

test('a link straight to an order works, and the flow runs end to end', async ({ page }) => {
  await open(page, '#/order/3')
  await expect(page.getByText('Funds are locked. Waiting for the farmer to accept.')).toBeVisible()

  await page.getByLabel('View as').selectOption({ label: 'Farmer' })
  await page.getByRole('button', { name: 'Accept order' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'The farmer accepted' })).toBeVisible()
})

test('the demo identifies itself as simulated, never as the real thing', async ({ page }) => {
  await open(page)
  await expect(page.getByText(/Everything here is simulated in your browser/)).toBeVisible()
  await expect(page.getByText(/no real money/)).toBeVisible()
  // No Freighter prompt: this build has no wallet.
  await expect(page.getByRole('link', { name: 'Install Freighter' })).toHaveCount(0)
})
