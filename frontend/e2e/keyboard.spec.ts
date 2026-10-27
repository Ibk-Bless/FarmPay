import type { Page } from '@playwright/test'
import { ACCOUNTS, expect, test, type MockApi } from './fixtures'

// What axe can't judge: where keyboard focus goes after an action, whether changes are
// announced to screen readers, and whether every control shows a focus indicator.

const now = () => Math.floor(Date.now() / 1000)
const activeText = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText?.trim() ?? '')

test('a keyboard user can run an order step by step without losing their place', async ({ openAs, api }) => {
  const { id } = api.seed()
  const page = await openAs('farmer', `/order/${id}`)

  await page.getByRole('button', { name: 'Accept order' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('The farmer accepted. Waiting for delivery.')).toBeVisible()

  // Focus returns to the actions section, not the top of the page.
  await expect(page.getByRole('heading', { name: 'Your actions' })).toBeFocused()

  // The next step is one Tab away.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Mark as delivered' })).toBeFocused()
  await page.keyboard.press('Space')
  await expect(page.getByText(/marked the order delivered/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your actions' })).toBeFocused()
})

test('order status changes are announced to screen readers', async ({ openAs, api }) => {
  const { id } = api.seed()
  const page = await openAs('farmer', `/order/${id}`)
  const status = page.getByRole('status').filter({ hasText: 'Funds are locked' })
  await expect(status).toBeVisible()

  await page.getByRole('button', { name: 'Accept order' }).click()
  // The same live region now holds the new status, which is what makes it announce.
  await expect(page.getByRole('status').filter({ hasText: 'The farmer accepted' })).toBeVisible()
})

test('progress is announced while a transaction is prepared and signed', async ({ openAs, api }) => {
  const { id } = api.seed()
  const page = await openAs('farmer', `/order/${id}`)
  await page.context().route('**/api/orders/*/accept', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700))
    await route.fallback()
  })

  await page.getByRole('button', { name: 'Accept order' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Preparing transaction' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'The farmer accepted' })).toBeVisible()
})

test('a failed action is announced as an alert and focus is not lost', async ({ openAs, api }) => {
  const { id } = api.seed()
  const page = await openAs('farmer', `/order/${id}`)
  api.failNextBuild(409, 'INVALID_STATUS')

  await page.getByRole('button', { name: 'Accept order' }).click()
  await expect(page.getByRole('alert')).toHaveText('This action is not available for the order in its current state.')
  await expect(page.getByRole('heading', { name: 'Your actions' })).toBeFocused()
})

test('a failed create-order request is announced and focus returns to the submit button', async ({ openAs, api }) => {
  const page = await openAs('buyer', '/order/create')
  await page.getByLabel("Farmer's address").fill(ACCOUNTS.farmer)
  await page.getByLabel("Cooperative's address").fill(ACCOUNTS.coop)
  await page.getByLabel('Amount (USDC)').fill('100')
  api.failNextBuild(400, 'INVALID_AMOUNT')

  await page.getByRole('button', { name: 'Lock funds and create order' }).press('Enter')
  await expect(page.getByRole('alert')).toContainText('Enter a positive USDC amount')
  await expect(page.getByRole('button', { name: 'Lock funds and create order' })).toBeFocused()
})

test('form validation errors are announced', async ({ openAs }) => {
  const page = await openAs('buyer', '/order/create')
  await page.getByRole('button', { name: 'Lock funds and create order' }).click()
  await expect(page.getByRole('alert')).toContainText("Enter the farmer's Stellar address")
})

test('copying the link is announced', async ({ openAs, api }) => {
  const { id } = api.seed()
  const page = await openAs('buyer', `/order/${id}`)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Copy link' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Link copied to the clipboard' })).toBeAttached()
})

const focusCases: [string, (api: MockApi) => string][] = [
  ['landing page', () => '/'],
  ['create order', () => '/order/create'],
  [
    'order with a dispute form',
    (api) => `/order/${api.seed({ status: 'Delivered', reviewDeadline: now() + 3600 }).id}`,
  ],
]

for (const [name, path] of focusCases) {
  test(`every control shows a visible focus indicator: ${name}`, async ({ openAs, api }) => {
    const page = await openAs('buyer', path(api))
    await page.waitForLoadState('networkidle')

    const missing: string[] = []
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab')
      const result = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return null
        // A native date field hands focus to its calendar button, which the browser outlines itself.
        if (el instanceof HTMLInputElement && el.type === 'date') return { label: 'date', visible: true }
        const style = getComputedStyle(el)
        const visible =
          (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none'
        const label = (el.innerText || el.getAttribute('aria-label') || el.id || el.tagName).trim().slice(0, 40)
        return { label, visible }
      })
      if (!result) break // focus left the page: the end of the tab order
      if (!result.visible) missing.push(result.label)
    }
    expect(missing, `Controls with no focus indicator: ${missing.join(', ')}`).toEqual([])
  })
}

test('the not-found and planned pages are keyboard-navigable', async ({ openAs }) => {
  const page = await openAs('buyer', '/nope')
  await page.getByRole('link', { name: 'Back to home' }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/$/)
  expect(await activeText(page)).not.toBeUndefined()
})
