import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

// The order page follows changes made by the other parties without a reload.

const setVisibility = (page: Page, state: 'visible' | 'hidden') =>
  page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)

test('the buyer sees the farmer accept without reloading', async ({ openAs, api }) => {
  const { id } = api.seed()
  const buyer = await openAs('buyer', `/order/${id}`, { fakeClock: true })
  await expect(buyer.getByText('Funds are locked. Waiting for the farmer to accept.')).toBeVisible()

  api.orders.get(id)!.status = 'Accepted' // the farmer acts elsewhere
  await buyer.clock.runFor(15_000)
  await expect(buyer.getByText('The farmer accepted. Waiting for delivery.')).toBeVisible()
})

test('a finished order is not polled', async ({ openAs, api }) => {
  const { id } = api.seed({ status: 'Released' })
  const page = await openAs('buyer', `/order/${id}`, { fakeClock: true })
  await expect(page.getByText('Complete. The farmer was paid in full.')).toBeVisible()
  const before = api.orderReads

  await page.clock.runFor(120_000)
  expect(api.orderReads).toBe(before)
})

test('polling pauses while the tab is hidden and catches up when it is shown', async ({ openAs, api }) => {
  const { id } = api.seed()
  const page = await openAs('buyer', `/order/${id}`, { fakeClock: true })
  await expect(page.getByText('Funds are locked. Waiting for the farmer to accept.')).toBeVisible()

  await setVisibility(page, 'hidden')
  const before = api.orderReads
  await page.clock.runFor(120_000)
  expect(api.orderReads).toBe(before)

  api.orders.get(id)!.status = 'Accepted'
  await setVisibility(page, 'visible') // refreshes at once, without waiting for the next tick
  await expect(page.getByText('The farmer accepted. Waiting for delivery.')).toBeVisible()
})

test('one request per interval, not one per render (StrictMode double-mounts)', async ({ openAs, api }) => {
  const { id } = api.seed()
  const page = await openAs('buyer', `/order/${id}`, { fakeClock: true })
  await expect(page.getByText('Funds are locked. Waiting for the farmer to accept.')).toBeVisible()
  const before = api.orderReads

  await page.clock.runFor(15_000 * 4)
  await expect.poll(() => api.orderReads - before).toBe(4)
})

test('a failed background refresh keeps the order on screen', async ({ openAs, api }) => {
  const { id } = api.seed()
  const page = await openAs('buyer', `/order/${id}`, { fakeClock: true })
  await expect(page.getByText('Funds are locked. Waiting for the farmer to accept.')).toBeVisible()

  await page.context().route('**/api/orders/*', (route) => route.abort('connectionrefused'))
  await page.clock.runFor(15_000)
  await expect(page.getByText('Funds are locked. Waiting for the farmer to accept.')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
