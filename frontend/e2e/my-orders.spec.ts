import { ACCOUNTS, expect, test } from './fixtures'

const now = () => Math.floor(Date.now() / 1000)
const HOUR = 3600

test('without a wallet it asks the visitor to connect', async ({ openAs }) => {
  const page = await openAs('buyer', '/orders', { approved: false })
  await expect(page.getByText('Connect your wallet to see your orders.')).toBeVisible()
  await page.getByRole('main').getByRole('button', { name: 'Connect wallet' }).click()
  await expect(page.getByRole('heading', { name: 'My orders' })).toBeVisible()
  await expect(page.getByText('No orders yet')).toBeVisible()
})

test('a buyer sees what needs action first, soonest deadline on top, and only their own orders', async ({ openAs, api }) => {
  // The OLDER order is the more urgent one, so "soonest deadline first" and "newest first" disagree.
  api.seed({ amount: '10', status: 'Delivered', reviewDeadline: now() + 2 * HOUR }) // #1: sooner
  api.seed({ amount: '20', status: 'Delivered', reviewDeadline: now() + 10 * HOUR }) // #2: later
  api.seed({ amount: '30', status: 'Funded' }) // #3: waiting for the farmer
  api.seed({ amount: '40', status: 'Released' }) // #4: done
  api.seed({ amount: '99', buyer: ACCOUNTS.stranger }) // #5: someone else's

  const page = await openAs('buyer', '/buyer/dashboard')
  await expect(page.getByRole('heading', { name: 'Buyer dashboard' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Needs your action \(2\)/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Waiting on others \(1\)/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Completed \(1\)/ })).toBeVisible()

  // The order whose review window closes soonest is listed first, with the time left.
  const urgent = page.getByRole('region', { name: /Needs your action/ }).getByRole('listitem')
  await expect(urgent.first()).toContainText('Order #1')
  await expect(urgent.first()).toContainText(/\((?:2h 0m|1h 59m) to review\)/)
  await expect(urgent.last()).toContainText('Order #2')

  await expect(page.getByText('Order #5')).toHaveCount(0)
})

test('a farmer can accept an order from the list, and it moves to the next step at once', async ({ openAs, api }) => {
  const { id } = api.seed({ amount: '500' })
  const page = await openAs('farmer', '/farmer/dashboard')

  await expect(page.getByRole('heading', { name: 'Farmer dashboard' })).toBeVisible()
  await page.getByRole('button', { name: 'Accept order' }).click()

  // Shown immediately (the server's list lags the chain by a few seconds)...
  await expect(page.getByRole('button', { name: 'Mark as delivered' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Accept order' })).toHaveCount(0)
  // ...and the action really was sent, signed by the farmer.
  expect(api.built.at(-1)).toMatchObject({ orderId: id, action: 'accept' })
  expect(api.orders.get(id)?.status).toBe('Accepted')
})

test('keyboard focus stays on the order after a one-click action', async ({ openAs, api }) => {
  api.seed()
  const page = await openAs('farmer', '/farmer/dashboard')
  await page.getByRole('button', { name: 'Accept order' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Mark as delivered' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Order #1/ })).toBeFocused()
})

test('a farmer can claim payment from the list once the review window has ended', async ({ openAs, api }) => {
  const { id } = api.seed({ status: 'Delivered', reviewDeadline: now() - 60 })
  const page = await openAs('farmer', '/farmer/dashboard')
  await page.getByRole('button', { name: 'Claim payment' }).click()
  await expect(page.getByRole('heading', { name: /Completed \(1\)/ })).toBeVisible()
  expect(api.built.at(-1)).toMatchObject({ orderId: id, action: 'claim', body: { caller: ACCOUNTS.farmer } })
})

test('a buyer can confirm a delivery from the list', async ({ openAs, api }) => {
  api.seed({ status: 'Delivered', reviewDeadline: now() + 5 * HOUR })
  const page = await openAs('buyer', '/buyer/dashboard')
  await page.getByRole('button', { name: 'Confirm delivery' }).click()
  await expect(page.getByRole('heading', { name: /Completed \(1\)/ })).toBeVisible()
  expect(api.orders.get('1')?.status).toBe('Released')
})

test('whoever is connected can settle an expired dispute, and signs it as themselves', async ({ openAs, api }) => {
  api.seed({ status: 'Disputed', reviewDeadline: now() - 9000, disputeDeadline: now() - 60 })

  const coop = await openAs('coop', '/cooperative/dashboard')
  await expect(coop.getByRole('heading', { name: 'Cooperative dashboard' })).toBeVisible()
  await expect(coop.getByText('The cooperative did not rule in time')).toBeVisible()
  await coop.getByRole('button', { name: 'Settle by default' }).click()
  await expect(coop.getByRole('heading', { name: /Completed \(1\)/ })).toBeVisible()
  // The API would otherwise pick one of the order's parties, who is not who is signing here.
  expect(api.built.at(-1)).toMatchObject({ action: 'expire', body: { caller: ACCOUNTS.coop } })
})

test('a cooperative sees the disputes waiting for its ruling, with the time left', async ({ openAs, api }) => {
  api.seed({ status: 'Disputed', reviewDeadline: now() - 3600, disputeDeadline: now() + 3 * 86400 })
  const page = await openAs('coop', '/cooperative/dashboard')
  const card = page.getByRole('region', { name: /Needs your action/ }).getByRole('listitem')
  await expect(card).toContainText('Rule on this dispute')
  await expect(card).toContainText(/\((?:2d 23h|3d 0h) to rule\)/)
  // Ruling needs a split amount, so it is done on the order page.
  await card.getByRole('link', { name: 'Open order' }).click()
  await expect(page).toHaveURL(/\/order\/1$/)
})

test('My orders combines every role an account plays', async ({ openAs, api }) => {
  api.seed({ amount: '10' }) // the farmer account is the farmer here
  api.seed({ amount: '20', buyer: ACCOUNTS.farmer, farmer: ACCOUNTS.stranger }) // ...and the buyer here
  const page = await openAs('farmer', '/orders')
  await expect(page.getByRole('heading', { name: 'My orders' })).toBeVisible()
  await expect(page.getByText('Buyer ' + ACCOUNTS.buyer.slice(0, 4))).toBeVisible()
  await expect(page.getByText('Farmer ' + ACCOUNTS.stranger.slice(0, 4))).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveCount(2)
})

test('both headers link to My orders', async ({ openAs }) => {
  for (const start of ['/', '/order/create']) {
    const page = await openAs('buyer', start)
    await page.getByRole('link', { name: 'My orders' }).click()
    await expect(page).toHaveURL(/\/orders$/)
  }
})

test('it says "loading" while the server reads the chain, then shows the orders', async ({ openAs, api }) => {
  api.seed()
  api.listSynced = false
  const page = await openAs('buyer', '/orders')
  await expect(page.getByRole('status')).toHaveText('Loading your orders…')
  await expect(page.getByText('No orders yet')).toHaveCount(0) // loading must not look like empty

  api.listSynced = true
  await expect(page.getByRole('heading', { name: /Waiting on others/ })).toBeVisible({ timeout: 10_000 })
  expect(api.listCalls).toBeGreaterThan(1) // it asked again by itself
})

test('an empty list points a buyer to Create an order, and shows a farmer their address to share', async ({ openAs }) => {
  const buyer = await openAs('buyer', '/buyer/dashboard')
  await expect(buyer.getByText('No orders yet')).toBeVisible()
  await buyer.getByRole('link', { name: 'Create an order' }).click()
  await expect(buyer).toHaveURL(/\/order\/create$/)

  const farmer = await openAs('farmer', '/farmer/dashboard')
  await expect(farmer.getByText(ACCOUNTS.farmer)).toBeVisible()
  await expect(farmer.getByRole('link', { name: 'Create an order' })).toHaveCount(0)
})

test('a failed load shows a clear message and Try again recovers', async ({ openAs, api }) => {
  api.seed()
  api.failNextList(503, 'INDEX_UNAVAILABLE')
  const page = await openAs('buyer', '/orders')
  await expect(page.getByRole('alert')).toHaveText("The list of orders isn't available right now. Please try again in a moment.")
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: /Waiting on others/ })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('every order links to its page', async ({ openAs, api }) => {
  api.seed({ amount: '12.5' })
  const page = await openAs('buyer', '/orders')
  await page.getByRole('link', { name: /Order #1 · 12\.50 USDC/ }).click()
  await expect(page).toHaveURL(/\/order\/1$/)
})
