import type { Route } from '@playwright/test'
import { expect, test } from './fixtures'

// What a visitor sees when the API is down, misconfigured or misbehaving.
// None of these may leave a blank page or show raw browser or HTTP text.

const failures: { name: string; handle: (route: Route) => Promise<void>; message: RegExp }[] = [
  {
    name: 'server unreachable',
    handle: (route) => route.abort('connectionrefused'),
    message: /Can't reach the FarmPay server/,
  },
  {
    name: 'proxy error page (502, HTML)',
    handle: (route) => route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad Gateway</html>' }),
    message: /The FarmPay server had a problem/,
  },
  {
    name: '500 with an empty body',
    handle: (route) => route.fulfill({ status: 500, body: '' }),
    message: /The FarmPay server had a problem/,
  },
  {
    name: 'host serving index.html for /api (200, not JSON)',
    handle: (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' }),
    message: /unexpected response/,
  },
]

for (const { name, handle, message } of failures) {
  test(`order page shows a clear message when: ${name}`, async ({ openAs, api }) => {
    const { id } = api.seed()
    const page = await openAs('buyer', `/order/${id}`)
    await expect(page.getByRole('heading', { name: '300.00 USDC' })).toBeVisible()

    await page.context().route('**/api/**', handle)
    await page.reload()

    await expect(page.getByRole('alert')).toHaveText(message)
    await expect(page.getByRole('alert')).not.toContainText(/Failed to fetch|Request failed/)
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })
}

test('"Try again" recovers once the server is back', async ({ openAs, api }) => {
  const { id } = api.seed()
  const page = await openAs('buyer', `/order/${id}`)
  await expect(page.getByRole('heading', { name: '300.00 USDC' })).toBeVisible()

  let down = true
  await page.context().route('**/api/**', (route) => (down ? route.abort('connectionrefused') : route.fallback()))
  await page.reload()
  await expect(page.getByRole('alert')).toHaveText(/Can't reach the FarmPay server/)

  down = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: '300.00 USDC' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a failure while acting shows a clear message and keeps the action available', async ({ openAs, api }) => {
  const { id } = api.seed()
  const farmer = await openAs('farmer', `/order/${id}`)
  const accept = farmer.getByRole('button', { name: 'Accept order' })
  await expect(accept).toBeVisible()

  let down = true
  await farmer.context().route('**/api/orders/*/accept', (route) =>
    down ? route.abort('connectionrefused') : route.fallback(),
  )
  await accept.click()
  await expect(farmer.getByText(/Can't reach the FarmPay server/)).toBeVisible()
  await expect(accept).toBeEnabled()
  expect(api.orders.get(id)?.status).toBe('Funded')

  down = false
  await accept.click()
  await expect(farmer.getByText('The farmer accepted. Waiting for delivery.')).toBeVisible()
})

test('an unexpected rendering crash shows a recovery screen, not a blank page', async ({ openAs }) => {
  const page = await openAs('buyer', '/')
  // Valid JSON, but not an order: the page cannot render it.
  await page.context().route('**/api/orders/1', (route) => route.fulfill({ status: 200, json: { unexpected: true } }))
  await page.goto('/order/1')

  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
  await expect(page.getByText('Your funds are not affected')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reload the page' })).toBeVisible()
})
