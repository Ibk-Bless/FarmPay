import { expect, test } from './fixtures'

test('landing page shows real testnet orders, not invented profiles', async ({ openAs }) => {
  const page = await openAs('buyer', '/')
  await expect(page.getByRole('heading', { name: /Guaranteed payment for farm deliveries/ })).toBeVisible()

  await expect(page.getByText('Order #1 — 125.50 USDC')).toBeVisible()
  await expect(page.getByText('Order #2 — 300 USDC')).toBeVisible()
  await expect(page.getByRole('link', { name: /View the contract on stellar.expert/ })).toHaveAttribute(
    'href',
    /stellar\.expert\/explorer\/testnet\/contract\/C/,
  )

  // Nothing fabricated: no invented farmer, buyer names or unverifiable claims.
  for (const invented of ['Amara Diallo', 'West Africa Exports', 'NutriFood', '100% on-time']) {
    await expect(page.getByText(invented)).toHaveCount(0)
  }
})

test('call to action leads to Create Order, not an unbuilt page', async ({ openAs }) => {
  const page = await openAs('buyer', '/')
  await page.getByRole('link', { name: 'Create Your First Order' }).click()
  await expect(page).toHaveURL(/\/order\/create$/)
})

test('unknown routes show a not-found page with a way back', async ({ openAs }) => {
  const page = await openAs('buyer', '/nope/not-a-page')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to home' }).click()
  await expect(page).toHaveURL(/\/$/)
})
