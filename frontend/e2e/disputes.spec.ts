import { ACCOUNTS, expect, test } from './fixtures'

// A dispute has a deadline: the cooperative can rule until then, and after it anyone can settle
// the order with an even split, so a missing cooperative can never lock the funds.

const now = () => Math.floor(Date.now() / 1000)
const DAY = 86400

test('the buyer chooses how long the cooperative has to decide, defaulting to 7 days', async ({ openAs, api }) => {
  const page = await openAs('buyer', '/order/create')
  await expect(page.getByLabel('Time for the cooperative to decide a dispute')).toHaveValue('7')

  await page.getByLabel("Farmer's address").fill(ACCOUNTS.farmer)
  await page.getByLabel("Cooperative's address").fill(ACCOUNTS.coop)
  await page.getByLabel('Amount (USDC)').fill('100')
  await page.getByLabel('Time for the cooperative to decide a dispute').selectOption('14')
  await page.getByRole('button', { name: 'Lock funds and create order' }).click()

  await expect(page).toHaveURL(/\/order\/1$/)
  expect(api.built[0].body).toMatchObject({ disputeWindowDays: 14 })
  await expect(page.getByText('14 days for the cooperative to rule, if a dispute is opened')).toBeVisible()
})

test('opening a dispute shows the deadline, and nobody can settle by default yet', async ({ openAs, api }) => {
  const { id } = api.seed({ status: 'Delivered', reviewDeadline: now() + 3600 })

  const buyer = await openAs('buyer', `/order/${id}`)
  await buyer.getByLabel(/Open a dispute/).fill('Short by 200kg')
  await buyer.getByRole('button', { name: 'Open dispute' }).click()
  await expect(buyer.getByText(/The cooperative must rule by/)).toBeVisible()
  await expect(buyer.getByText(/\(6d 23h left\)|\(7d 0h left\)/)).toBeVisible()
  await expect(buyer.getByRole('button', { name: 'Settle by default (even split)' })).toHaveCount(0)

  for (const role of ['farmer', 'stranger'] as const) {
    const page = await openAs(role, `/order/${id}`)
    await expect(page.getByRole('button', { name: 'Settle by default (even split)' })).toHaveCount(0)
  }
})

test('the cooperative can rule while its time is open', async ({ openAs, api }) => {
  const { id } = api.seed({ status: 'Disputed', reviewDeadline: now() - 3600, disputeDeadline: now() + DAY })
  const coop = await openAs('coop', `/order/${id}`)
  await coop.getByLabel(/Farmer's share/).fill('100')
  await coop.getByRole('button', { name: 'Resolve dispute' }).click()
  await expect(coop.getByText('Dispute resolved.')).toBeVisible()
})

test('after the deadline the cooperative can no longer rule, and anyone can settle evenly', async ({ openAs, api }) => {
  const { id } = api.seed({ status: 'Disputed', reviewDeadline: now() - 9000, disputeDeadline: now() - 60, amount: '300' })

  // The cooperative's ruling form is gone: the contract would refuse it.
  const coop = await openAs('coop', `/order/${id}`)
  await expect(coop.getByLabel(/Farmer's share/)).toHaveCount(0)
  await expect(coop.getByText('(passed)')).toBeVisible()
  await expect(coop.getByRole('status').filter({ hasText: 'The cooperative did not rule in time' })).toBeVisible()

  // A stranger with no part in the order can trigger the default settlement.
  const stranger = await openAs('stranger', `/order/${id}`)
  await stranger.getByRole('button', { name: 'Settle by default (even split)' }).click()
  await expect(stranger.getByText('Dispute resolved.')).toBeVisible()
  expect(api.built.at(-1)).toMatchObject({ action: 'expire', body: { caller: ACCOUNTS.stranger } })
  expect(api.orders.get(id)?.status).toBe('Resolved')
})

test('the buyer and the farmer can also settle an expired dispute', async ({ openAs, api }) => {
  for (const role of ['buyer', 'farmer'] as const) {
    const { id } = api.seed({ status: 'Disputed', reviewDeadline: now() - 9000, disputeDeadline: now() - 60 })
    const page = await openAs(role, `/order/${id}`)
    await page.getByRole('button', { name: 'Settle by default (even split)' }).click()
    await expect(page.getByText('Dispute resolved.')).toBeVisible()
  }
})
