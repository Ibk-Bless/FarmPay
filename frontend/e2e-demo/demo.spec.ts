import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// The interactive demo: the whole app running against an in-browser simulation of the contract.
// No mocks and no wallet: this is what a visitor to the hosted demo gets.

const as = (page: Page, role: 'Buyer' | 'Farmer' | 'Cooperative (arbiter)' | 'Visitor (no wallet)') =>
  page.getByLabel('View as').selectOption({ label: role })

const act = async (page: Page, button: string, status: string | RegExp) => {
  await page.getByRole('button', { name: button }).click()
  await expect(page.getByRole('status').filter({ hasText: status })).toBeVisible()
}

test('a visitor lands on a clearly labelled demo with three starting orders', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Demo controls' })).toContainText('Everything here is simulated')
  await expect(page.getByLabel('View as')).toHaveValue('buyer')

  await page.goto('/#/order/1')
  await expect(page.getByText('Complete. The farmer was paid in full.')).toBeVisible()
  await page.goto('/#/order/2')
  await expect(page.getByText('Dispute resolved.')).toBeVisible()
  await page.goto('/#/order/3')
  await expect(page.getByText('Funds are locked. Waiting for the farmer to accept.')).toBeVisible()
})

test('happy path: the farmer accepts and delivers, the buyer confirms', async ({ page }) => {
  await page.goto('/#/order/3')
  await as(page, 'Farmer')
  await act(page, 'Accept order', 'The farmer accepted')
  await act(page, 'Mark as delivered', /marked the order delivered/)
  await expect(page.getByText(/left\)/)).toBeVisible() // the review-window countdown

  await as(page, 'Buyer')
  await act(page, 'Confirm delivery and pay farmer', 'Complete. The farmer was paid in full.')
})

test('a buyer creates an order with the prefilled demo accounts and it can be completed', async ({ page }) => {
  await page.goto('/#/order/create')
  await expect(page.getByLabel('Amount (USDC)')).toHaveValue('250')
  await page.getByLabel('Amount (USDC)').fill('99.5')
  await page.getByRole('button', { name: 'Lock funds and create order' }).click()

  await expect(page).toHaveURL(/#\/order\/4$/)
  await expect(page.getByRole('heading', { name: '99.50 USDC' })).toBeVisible()

  await as(page, 'Farmer')
  await act(page, 'Accept order', 'The farmer accepted')
})

test('dispute: the buyer disputes and the cooperative splits the funds', async ({ page }) => {
  await page.goto('/#/order/3')
  await as(page, 'Farmer')
  await act(page, 'Accept order', 'The farmer accepted')
  await act(page, 'Mark as delivered', /marked the order delivered/)

  await as(page, 'Buyer')
  await page.getByLabel(/Open a dispute/).fill('Short by 200kg')
  await act(page, 'Open dispute', 'The buyer opened a dispute')

  await as(page, 'Cooperative (arbiter)')
  await page.getByLabel(/Farmer's share/).fill('1500')
  await expect(page.getByText('The buyer is refunded 340.50 USDC.')).toBeVisible()
  await act(page, 'Resolve dispute', 'Dispute resolved')
})

test('the contract rules hold: a split larger than the order is refused', async ({ page }) => {
  await page.goto('/#/order/3')
  await as(page, 'Farmer')
  await act(page, 'Accept order', 'The farmer accepted')
  await act(page, 'Mark as delivered', /marked the order delivered/)
  await as(page, 'Buyer')
  await page.getByLabel(/Open a dispute/).fill('Wrong grade')
  await act(page, 'Open dispute', 'The buyer opened a dispute')

  await as(page, 'Cooperative (arbiter)')
  await page.getByLabel(/Farmer's share/).fill('99999')
  await page.getByRole('button', { name: 'Resolve dispute' }).click()
  await expect(page.getByRole('alert')).toContainText("The farmer's share must be between 0 and the order amount.")
})

test('time travel: after the review window the farmer can claim and the buyer can no longer dispute', async ({ page }) => {
  await page.goto('/#/order/3')
  await as(page, 'Farmer')
  await act(page, 'Accept order', 'The farmer accepted')
  await act(page, 'Mark as delivered', /marked the order delivered/)

  // Inside the window the farmer has nothing to claim, and the buyer can still dispute.
  await expect(page.getByRole('button', { name: 'Release payment to farmer' })).toHaveCount(0)
  await as(page, 'Buyer')
  await expect(page.getByLabel(/Open a dispute/)).toBeVisible()

  for (let day = 0; day < 4; day++) await page.getByRole('button', { name: 'Skip ahead 1 day' }).click()
  await expect(page.getByText('Demo clock: +4 days')).toBeVisible()

  await expect(page.getByLabel(/Open a dispute/)).toHaveCount(0)
  await as(page, 'Farmer')
  await act(page, 'Release payment to farmer', 'Complete. The farmer was paid in full.')
})

// The dispute deadline: the cooperative can rule until it, and after it anyone can settle evenly.
const reachDispute = async (page: Page) => {
  await page.goto('/#/order/3')
  await as(page, 'Farmer')
  await act(page, 'Accept order', 'The farmer accepted')
  await act(page, 'Mark as delivered', /marked the order delivered/)
  await as(page, 'Buyer')
  await page.getByLabel(/Open a dispute/).fill('Short by 200kg')
  await act(page, 'Open dispute', 'The buyer opened a dispute')
}
const skip = async (page: Page, days: number) => {
  for (let day = 0; day < days; day++) await page.getByRole('button', { name: 'Skip ahead 1 day' }).click()
}

test('a dispute shows the deadline, and nobody can settle by default while it is open', async ({ page }) => {
  await reachDispute(page)
  await expect(page.getByText(/The cooperative must rule by/)).toBeVisible()
  await expect(page.getByText(/\(6d 23h left\)|\(7d 0h left\)/)).toBeVisible()
  for (const role of ['Buyer', 'Farmer', 'Visitor (no wallet)'] as const) {
    await as(page, role)
    await expect(page.getByRole('button', { name: 'Settle by default (even split)' })).toHaveCount(0)
  }
})

test('the cooperative can rule right up to the deadline', async ({ page }) => {
  await reachDispute(page)
  await skip(page, 6)
  await as(page, 'Cooperative (arbiter)')
  await page.getByLabel(/Farmer's share/).fill('1000')
  await act(page, 'Resolve dispute', 'Dispute resolved')
})

test('after the deadline the cooperative cannot rule and anyone can settle evenly', async ({ page }) => {
  await reachDispute(page)
  await skip(page, 8)

  await as(page, 'Cooperative (arbiter)')
  await expect(page.getByLabel(/Farmer's share/)).toHaveCount(0)
  await expect(page.getByText('(passed)')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'The cooperative did not rule in time' })).toBeVisible()

  // Even someone with no part in the order (no wallet role) can settle it once a role is chosen.
  await as(page, 'Buyer')
  await act(page, 'Settle by default (even split)', 'Dispute resolved')
})

test('the buyer chooses the dispute window, and a 1-day window expires after a day', async ({ page }) => {
  await page.goto('/#/order/create')
  await page.getByLabel('Time for the cooperative to decide a dispute').selectOption('1')
  await page.getByRole('button', { name: 'Lock funds and create order' }).click()
  await expect(page.getByText('1 days for the cooperative to rule, if a dispute is opened')).toBeVisible()

  await as(page, 'Farmer')
  await act(page, 'Accept order', 'The farmer accepted')
  await act(page, 'Mark as delivered', /marked the order delivered/)
  await as(page, 'Buyer')
  await page.getByLabel(/Open a dispute/).fill('Wrong grade')
  await act(page, 'Open dispute', 'The buyer opened a dispute')

  await skip(page, 2)
  await act(page, 'Settle by default (even split)', 'Dispute resolved')
})

test('the buyer can cancel an accepted order once its delivery deadline has passed', async ({ page }) => {
  await page.goto('/#/order/3')
  await as(page, 'Farmer')
  await act(page, 'Accept order', 'The farmer accepted')

  await as(page, 'Buyer')
  await expect(page.getByRole('button', { name: /Cancel and refund/ })).toHaveCount(0)
  for (let day = 0; day < 8; day++) await page.getByRole('button', { name: 'Skip ahead 1 day' }).click()
  await act(page, 'Cancel and refund 1,840.50 USDC', 'Cancelled. The buyer was refunded in full.')
})

test('a visitor without a wallet is asked to choose a role', async ({ page }) => {
  await page.goto('/#/order/create')
  await as(page, 'Visitor (no wallet)')
  await expect(page.getByText('Connect the wallet that will pay for this order.')).toBeVisible()
  await as(page, 'Buyer')
  await expect(page.getByRole('button', { name: 'Lock funds and create order' })).toBeVisible()
})

test('progress survives a reload, and "Reset demo" restores the starting orders', async ({ page }) => {
  await page.goto('/#/order/3')
  await as(page, 'Farmer')
  await act(page, 'Accept order', 'The farmer accepted')
  await page.getByRole('button', { name: 'Skip ahead 1 day' }).click()

  await page.reload()
  await expect(page.getByText('The farmer accepted. Waiting for delivery.')).toBeVisible()
  await expect(page.getByText('Demo clock: +1 day')).toBeVisible()
  await expect(page.getByLabel('View as')).toHaveValue('farmer')

  // Resetting returns to the start page, since an order you were viewing may no longer exist.
  await page.getByRole('button', { name: 'Reset demo' }).click()
  await expect(page.getByRole('heading', { name: /Guaranteed payment for farm deliveries/ })).toBeVisible()
  await expect(page.getByText('Demo clock: now')).toBeVisible()

  await page.goto('/#/order/3')
  await expect(page.getByText('Funds are locked. Waiting for the farmer to accept.')).toBeVisible()
})

test('an unknown order gives the same clear message as the real app', async ({ page }) => {
  await page.goto('/#/order/999')
  await expect(page.getByText('No order with this number exists.')).toBeVisible()
})

for (const [name, path, role] of [
  ['landing page', '/', 'Buyer'],
  ['create order', '/#/order/create', 'Buyer'],
  ['order awaiting the farmer', '/#/order/3', 'Farmer'],
  ['order as a visitor', '/#/order/3', 'Visitor (no wallet)'],
] as const) {
  test(`no accessibility violations in the demo: ${name}`, async ({ page }) => {
    await page.goto(path)
    await as(page, role)
    await page.waitForLoadState('networkidle')
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const summary = violations.map((v) => `${v.id}: ${v.help}\n    ${v.nodes.map((n) => n.html.slice(0, 100)).join('\n    ')}`)
    expect(summary, `Violations:\n${summary.join('\n')}`).toEqual([])
  })
}

for (const [name, path] of [
  ['landing page', '/'],
  ['create order', '/#/order/create'],
  ['order', '/#/order/3'],
  ['not found', '/#/nope'],
] as const) {
  test(`fits a phone screen without horizontal scrolling: ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth)
  })
}
