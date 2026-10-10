import { test as base, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test'

export const TESTNET = 'Test SDF Network ; September 2015'
export const MAINNET = 'Public Global Stellar Network ; September 2015'

// Syntactically valid account addresses (G + 55 base32 characters).
export const ACCOUNTS = {
  buyer: 'G' + 'B'.repeat(55),
  farmer: 'G' + 'C'.repeat(55),
  coop: 'G' + 'D'.repeat(55),
  stranger: 'G' + 'E'.repeat(55),
}
export type Role = keyof typeof ACCOUNTS

export const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`

type Status = 'Funded' | 'Accepted' | 'Delivered' | 'Disputed' | 'Released' | 'Refunded' | 'Resolved'

export interface MockOrder {
  id: string
  buyer: string
  farmer: string
  arbiter: string
  amount: string
  deliveryDeadline: number
  reviewWindow: number
  reviewDeadline: number
  status: Status
}

interface Built {
  kind: 'create' | 'action'
  orderId?: string
  action?: string
  body: Record<string, unknown>
}

const now = () => Math.floor(Date.now() / 1000)
const encode = (built: Built) => Buffer.from(JSON.stringify(built)).toString('base64')
const decode = (xdr: string): Built => JSON.parse(Buffer.from(xdr, 'base64').toString())

/**
 * In-memory stand-in for the FarmPay API. Built transactions are opaque base64
 * blobs; submitting one applies the same state transition the contract would.
 */
export class MockApi {
  orders = new Map<string, MockOrder>()
  built: Built[] = []
  private nextId = 1
  private failure: { status: number; code: string; message: string } | null = null

  seed(overrides: Partial<MockOrder> = {}): MockOrder {
    const id = String(this.nextId++)
    const order: MockOrder = {
      id,
      buyer: ACCOUNTS.buyer,
      farmer: ACCOUNTS.farmer,
      arbiter: ACCOUNTS.coop,
      amount: '300',
      deliveryDeadline: now() + 7 * 86400,
      reviewWindow: 72 * 3600,
      reviewDeadline: 0,
      status: 'Funded',
      ...overrides,
    }
    this.orders.set(id, order)
    return order
  }

  /** Make the next build request fail with the given API error. */
  failNextBuild(status: number, code: string, message = code) {
    this.failure = { status, code, message }
  }

  async attach(context: BrowserContext) {
    await context.route('**/api/**', (route) => this.handle(route))
  }

  private async handle(route: Route) {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/api/, '')
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
    const reply = (status: number, json: unknown) => route.fulfill({ status, json })
    const error = (status: number, code: string) => reply(status, { error: { code, message: code } })

    const orderMatch = /^\/orders\/([^/]+)$/.exec(path)
    if (request.method() === 'GET' && orderMatch) {
      const order = this.orders.get(orderMatch[1])
      return order ? reply(200, order) : error(404, 'ORDER_NOT_FOUND')
    }

    if (request.method() === 'POST' && (path === '/orders' || /^\/orders\/[^/]+\/[a-z]+$/.test(path))) {
      if (this.failure) {
        const { status, code } = this.failure
        this.failure = null
        return error(status, code)
      }
      const [, , orderId, action] = path.split('/')
      if (orderId && !this.orders.has(orderId)) return error(404, 'ORDER_NOT_FOUND')
      const built: Built = orderId ? { kind: 'action', orderId, action, body } : { kind: 'create', body }
      this.built.push(built)
      return reply(200, { orderId, action: action ?? 'create', xdr: encode(built) })
    }

    if (request.method() === 'POST' && path === '/transactions') {
      const built = decode(String(body.signedXdr))
      if (built.kind === 'create') {
        const input = built.body
        const order = this.seed({
          buyer: String(input.buyer),
          farmer: String(input.farmer),
          arbiter: String(input.arbiter),
          amount: String(input.amount),
          deliveryDeadline: Math.floor(Date.parse(String(input.deliveryDeadline)) / 1000),
          reviewWindow: Number(input.reviewWindowHours) * 3600,
        })
        return reply(200, { hash: 'mockhash', orderId: order.id })
      }
      this.apply(this.orders.get(built.orderId!)!, built.action!)
      return reply(200, { hash: 'mockhash' })
    }

    return error(404, 'NOT_FOUND')
  }

  private apply(order: MockOrder, action: string) {
    const next: Record<string, Status> = {
      accept: 'Accepted',
      deliver: 'Delivered',
      confirm: 'Released',
      claim: 'Released',
      dispute: 'Disputed',
      resolve: 'Resolved',
      cancel: 'Refunded',
    }
    if (action === 'deliver') order.reviewDeadline = now() + order.reviewWindow
    order.status = next[action]
  }
}

export interface WalletOptions {
  installed?: boolean
  /** Already approved for this site, so the app reconnects without a click. */
  approved?: boolean
  network?: string
}

/** Fake Freighter extension: answers the freighter-api message protocol. */
async function installWallet(context: BrowserContext, address: string, options: WalletOptions) {
  const { installed = true, approved = true, network = TESTNET } = options
  if (!installed) return
  await context.addInitScript(
    ({ address, approved, network }) => {
      let allowed = approved
      ;(window as unknown as { freighter: boolean }).freighter = true
      window.addEventListener('message', (event) => {
        const msg = event.data
        if (event.source !== window || msg?.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST') return
        const reply = (data: object) =>
          window.postMessage(
            { source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE', messagedId: msg.messageId, ...data },
            window.location.origin,
          )
        switch (msg.type) {
          case 'REQUEST_ALLOWED_STATUS':
            return reply({ isAllowed: allowed })
          case 'REQUEST_ACCESS':
            allowed = true
            return reply({ publicKey: address })
          case 'REQUEST_PUBLIC_KEY':
            return reply({ publicKey: allowed ? address : '' })
          case 'REQUEST_NETWORK_DETAILS':
            return reply({ networkDetails: { network: 'TEST', networkUrl: '', networkPassphrase: network } })
          case 'SUBMIT_TRANSACTION':
            return reply({ signedTransaction: msg.transactionXdr, signerAddress: msg.accountToSign })
        }
      })
    },
    { address, approved, network },
  )
}

type OpenAs = (role: Role, path: string, options?: WalletOptions) => Promise<Page>

export const test = base.extend<{ api: MockApi; openAs: OpenAs }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their first argument
  api: async ({}, use) => {
    await use(new MockApi())
  },
  // Each role gets its own browser context (its own wallet), sharing one mock API.
  openAs: async ({ browser, api }, use) => {
    const contexts: BrowserContext[] = []
    await use(async (role, path, options = {}) => {
      const context = await newContext(browser, contexts)
      await api.attach(context)
      await installWallet(context, ACCOUNTS[role], options)
      const page = await context.newPage()
      await page.goto(path)
      return page
    })
    await Promise.all(contexts.map((c) => c.close()))
  },
})

async function newContext(browser: Browser, contexts: BrowserContext[]) {
  const context = await browser.newContext()
  contexts.push(context)
  return context
}

export { expect } from '@playwright/test'
