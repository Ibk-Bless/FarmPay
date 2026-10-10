import { ACCOUNTS, MAINNET, expect, short, test } from './fixtures'

test('offers to install Freighter when the extension is missing', async ({ openAs }) => {
  const page = await openAs('buyer', '/', { installed: false })
  await expect(page.getByRole('link', { name: 'Install Freighter' })).toBeVisible()
})

test('connects on click and disconnects', async ({ openAs }) => {
  const page = await openAs('buyer', '/', { approved: false })
  await page.getByRole('button', { name: 'Connect wallet' }).click()
  await expect(page.getByText(short(ACCOUNTS.buyer))).toBeVisible()

  await page.getByRole('button', { name: 'Disconnect' }).click()
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible()

  // An explicit disconnect is remembered: no silent reconnect after reload.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible()
})

test('reconnects silently when the site is already approved', async ({ openAs }) => {
  const page = await openAs('farmer', '/')
  await expect(page.getByText(short(ACCOUNTS.farmer))).toBeVisible()
})

test('warns and blocks signing on the wrong network', async ({ openAs }) => {
  const page = await openAs('buyer', '/order/create', { network: MAINNET })
  await expect(page.getByText('Switch Freighter to Testnet', { exact: true })).toBeVisible()
  await expect(page.getByText('Your wallet is on a different network.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Lock funds and create order' })).toBeDisabled()
})
