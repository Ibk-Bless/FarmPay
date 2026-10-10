import { ACCOUNTS, expect, test } from './fixtures'

const now = () => Math.floor(Date.now() / 1000)

test.describe('create order', () => {
  test('buyer locks funds and lands on the funded order', async ({ openAs, api }) => {
    const page = await openAs('buyer', '/order/create')
    await page.getByLabel("Farmer's address").fill(ACCOUNTS.farmer)
    await page.getByLabel("Cooperative's address").fill(ACCOUNTS.coop)
    await page.getByLabel('Amount (USDC)').fill('1840.50')
    await page.getByRole('button', { name: 'Lock funds and create order' }).click()

    await expect(page).toHaveURL(/\/order\/1$/)
    await expect(page.getByText('Funds are locked. Waiting for the farmer to accept.')).toBeVisible()
    await expect(page.getByRole('heading', { name: '1,840.50 USDC' })).toBeVisible()
    expect(api.built[0].body).toMatchObject({
      buyer: ACCOUNTS.buyer,
      farmer: ACCOUNTS.farmer,
      arbiter: ACCOUNTS.coop,
      amount: '1840.50',
      reviewWindowHours: 72,
    })
  })

  test('rejects invalid input before building a transaction', async ({ openAs, api }) => {
    const page = await openAs('buyer', '/order/create')
    const submit = page.getByRole('button', { name: 'Lock funds and create order' })

    await page.getByLabel("Farmer's address").fill('not-an-address')
    await submit.click()
    await expect(page.getByText("Enter the farmer's Stellar address")).toBeVisible()

    await page.getByLabel("Farmer's address").fill(ACCOUNTS.farmer)
    await page.getByLabel("Cooperative's address").fill(ACCOUNTS.farmer)
    await page.getByLabel('Amount (USDC)').fill('100')
    await submit.click()
    await expect(page.getByText('must be three different accounts')).toBeVisible()

    await page.getByLabel("Cooperative's address").fill(ACCOUNTS.coop)
    await page.getByLabel('Amount (USDC)').fill('0')
    await submit.click()
    await expect(page.getByText('Enter a positive USDC amount.')).toBeVisible()

    expect(api.built).toHaveLength(0)
  })
})

test.describe('order page', () => {
  test('shows each role only the actions it can take', async ({ openAs, api }) => {
    const { id } = api.seed({ status: 'Funded' })

    const farmer = await openAs('farmer', `/order/${id}`)
    await expect(farmer.getByRole('button', { name: 'Accept order' })).toBeVisible()
    await expect(farmer.getByRole('button', { name: /Cancel/ })).toHaveCount(0)

    const buyer = await openAs('buyer', `/order/${id}`)
    await expect(buyer.getByRole('button', { name: 'Cancel and refund 300.00 USDC' })).toBeVisible()
    await expect(buyer.getByRole('button', { name: 'Accept order' })).toHaveCount(0)

    const coop = await openAs('coop', `/order/${id}`)
    await expect(coop.getByText('Nothing for you to do right now.')).toBeVisible()

    const stranger = await openAs('stranger', `/order/${id}`)
    await expect(stranger.getByText('Your connected account is not part of this order.')).toBeVisible()
  })

  test('happy path: accept, deliver, confirm', async ({ openAs, api }) => {
    const { id } = api.seed({ amount: '125.5' })

    const farmer = await openAs('farmer', `/order/${id}`)
    await farmer.getByRole('button', { name: 'Accept order' }).click()
    await expect(farmer.getByText('The farmer accepted. Waiting for delivery.')).toBeVisible()
    await farmer.getByRole('button', { name: 'Mark as delivered' }).click()
    await expect(farmer.getByText('marked the order delivered')).toBeVisible()
    await expect(farmer.getByText(/\(2d 23h left\)|\(3d 0h left\)/)).toBeVisible()

    const buyer = await openAs('buyer', `/order/${id}`)
    await buyer.getByRole('button', { name: 'Confirm delivery and pay farmer' }).click()
    await expect(buyer.getByText('Complete. The farmer was paid in full.')).toBeVisible()
    expect(api.orders.get(id)?.status).toBe('Released')
  })

  test('dispute: buyer disputes and the cooperative splits the funds', async ({ openAs, api }) => {
    const { id } = api.seed({ status: 'Delivered', reviewDeadline: now() + 3600 })

    const buyer = await openAs('buyer', `/order/${id}`)
    const disputeButton = buyer.getByRole('button', { name: 'Open dispute' })
    await expect(disputeButton).toBeDisabled()
    await buyer.getByLabel(/Open a dispute/).fill('100kg short')
    await disputeButton.click()
    await expect(buyer.getByText('The buyer opened a dispute.')).toBeVisible()
    expect(api.built.at(-1)).toMatchObject({ action: 'dispute', body: { reason: '100kg short' } })

    const coop = await openAs('coop', `/order/${id}`)
    await coop.getByLabel(/Farmer's share/).fill('200')
    await expect(coop.getByText('The buyer is refunded 100.00 USDC.')).toBeVisible()
    await coop.getByRole('button', { name: 'Resolve dispute' }).click()
    await expect(coop.getByText('Dispute resolved.')).toBeVisible()
    expect(api.built.at(-1)).toMatchObject({ action: 'resolve', body: { farmerAmount: '200' } })
  })

  test('after the review window, anyone can release payment but the buyer can no longer dispute', async ({ openAs, api }) => {
    const { id } = api.seed({ status: 'Delivered', reviewDeadline: now() - 60 })

    const buyer = await openAs('buyer', `/order/${id}`)
    await expect(buyer.getByLabel(/Open a dispute/)).toHaveCount(0)

    const stranger = await openAs('stranger', `/order/${id}`)
    await stranger.getByRole('button', { name: 'Release payment to farmer' }).click()
    await expect(stranger.getByText('Complete. The farmer was paid in full.')).toBeVisible()
    expect(api.built.at(-1)).toMatchObject({ action: 'claim', body: { caller: ACCOUNTS.stranger } })
  })

  test('buyer can cancel an accepted order once the delivery deadline has passed', async ({ openAs, api }) => {
    const late = api.seed({ status: 'Accepted', deliveryDeadline: now() - 60 })
    const onTime = api.seed({ status: 'Accepted' })

    const buyer = await openAs('buyer', `/order/${onTime.id}`)
    await expect(buyer.getByRole('button', { name: /Cancel/ })).toHaveCount(0)

    await buyer.goto(`/order/${late.id}`)
    await buyer.getByRole('button', { name: /Cancel and refund/ }).click()
    await expect(buyer.getByText('Cancelled. The buyer was refunded in full.')).toBeVisible()
  })

  test('shows a readable message when the contract rejects an action', async ({ openAs, api }) => {
    const { id } = api.seed()
    api.failNextBuild(409, 'INVALID_STATUS')

    const farmer = await openAs('farmer', `/order/${id}`)
    await farmer.getByRole('button', { name: 'Accept order' }).click()
    await expect(farmer.getByText('This action is not available for the order in its current state.')).toBeVisible()
    expect(api.orders.get(id)?.status).toBe('Funded')
  })

  test('shows a message for an unknown order', async ({ openAs }) => {
    const page = await openAs('buyer', '/order/999')
    await expect(page.getByText('No order with this number exists.')).toBeVisible()
  })
})
