import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test, type MockApi, type Role } from './fixtures'

// Automated WCAG 2.1 A/AA checks with axe-core on every page and state. These catch
// contrast, missing labels, bad structure and ARIA misuse; they do not replace testing
// with a real screen reader.

const now = () => Math.floor(Date.now() / 1000)

async function expectNoViolations(page: Page) {
  await page.waitForLoadState('networkidle')
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const summary = violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.html.slice(0, 100)).join('\n    ')}`,
  )
  expect(summary, `Accessibility violations:\n${summary.join('\n')}`).toEqual([])
}

const pages: { name: string; role: Role; path: (api: MockApi) => string; ready: RegExp | string }[] = [
  { name: 'landing page', role: 'buyer', path: () => '/', ready: 'Order #1 — 125.50 USDC' },
  { name: 'create order', role: 'buyer', path: () => '/order/create', ready: 'Lock funds and create order' },
  { name: 'not found', role: 'buyer', path: () => '/nope', ready: 'Page not found' },
  { name: 'planned page', role: 'buyer', path: () => '/buyer/dashboard', ready: 'Buyer Dashboard' },
  { name: 'order: funded (farmer)', role: 'farmer', path: (api) => `/order/${api.seed().id}`, ready: 'Accept order' },
  {
    name: 'order: accepted (farmer)',
    role: 'farmer',
    path: (api) => `/order/${api.seed({ status: 'Accepted' }).id}`,
    ready: 'Mark as delivered',
  },
  {
    name: 'order: delivered, review open (buyer, dispute form)',
    role: 'buyer',
    path: (api) => `/order/${api.seed({ status: 'Delivered', reviewDeadline: now() + 3600 }).id}`,
    ready: 'Confirm delivery and pay farmer',
  },
  {
    name: 'order: disputed (cooperative, split form)',
    role: 'coop',
    path: (api) => `/order/${api.seed({ status: 'Disputed', reviewDeadline: now() + 3600 }).id}`,
    ready: 'Resolve dispute',
  },
  {
    name: 'order: released (stranger)',
    role: 'stranger',
    path: (api) => `/order/${api.seed({ status: 'Released', reviewDeadline: now() - 60 }).id}`,
    ready: 'Complete. The farmer was paid in full.',
  },
]

for (const { name, role, path, ready } of pages) {
  test(`no accessibility violations: ${name}`, async ({ openAs, api }) => {
    const page = await openAs(role, path(api))
    await expect(page.getByText(ready).first()).toBeVisible()
    await expectNoViolations(page)
  })
}

test('no accessibility violations: wallet not connected', async ({ openAs }) => {
  const page = await openAs('buyer', '/order/create', { approved: false })
  await expect(page.getByRole('button', { name: 'Connect wallet' }).first()).toBeVisible()
  await expectNoViolations(page)
})

test('no accessibility violations: Freighter not installed', async ({ openAs }) => {
  const page = await openAs('buyer', '/', { installed: false })
  await expect(page.getByRole('link', { name: 'Install Freighter' })).toBeVisible()
  await expectNoViolations(page)
})
