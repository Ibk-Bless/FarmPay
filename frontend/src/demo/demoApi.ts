// In-browser stand-in for the FarmPay API, used only by the interactive demo build.
//
// It applies the same rules as the escrow contract (contracts/escrow/README.md) and answers
// with the same error codes as the real API, so the UI behaves exactly as it does against
// testnet. Nothing here talks to a network. State lives in sessionStorage.

import type { BuiltTransaction, CreateOrderInput, Order, OrderAction, OrderStatus, SubmitResult } from '../lib/api'
import { ApiError } from '../lib/errors'
import { clock } from '../lib/clock'
import { DEMO_ACCOUNTS } from './accounts'

// Bumped when the shape of a stored order changes, so an old browser session starts fresh.
const STORAGE_KEY = 'farmpay:demo:v2'
const DAY = 24 * 60 * 60
const MAX_REVIEW_WINDOW_HOURS = 24 * 365
const MIN_DISPUTE_WINDOW_DAYS = 1
const MAX_DISPUTE_WINDOW_DAYS = 30
const DEFAULT_DISPUTE_WINDOW_DAYS = 7
const MAX_REASON_LENGTH = 500
const ADDRESS = /^G[A-Z2-7]{55}$/

interface DemoState {
  orders: Order[]
  nextId: number
  offsetMs: number
}

const nowSeconds = () => Math.floor(clock.now() / 1000)

/** The orders a visitor finds on first load: two finished ones, and one waiting for the farmer. */
function seed(): DemoState {
  const t = Math.floor(Date.now() / 1000)
  const order = (o: Partial<Order> & Pick<Order, 'id' | 'amount' | 'status'>): Order => ({
    buyer: DEMO_ACCOUNTS.buyer,
    farmer: DEMO_ACCOUNTS.farmer,
    arbiter: DEMO_ACCOUNTS.cooperative,
    deliveryDeadline: t + 7 * DAY,
    reviewWindow: 3 * DAY,
    reviewDeadline: 0,
    disputeWindow: 7 * DAY,
    disputeDeadline: 0,
    ...o,
  })
  return {
    offsetMs: 0,
    nextId: 4,
    orders: [
      order({ id: '1', amount: '125.5', status: 'Released', deliveryDeadline: t - 6 * DAY, reviewDeadline: t - 2 * DAY }),
      order({ id: '2', amount: '300', status: 'Resolved', deliveryDeadline: t - 5 * DAY, reviewDeadline: t - 4 * DAY, disputeDeadline: t + 2 * DAY }),
      order({ id: '3', amount: '1840.5', status: 'Funded' }),
    ],
  }
}

function load(): DemoState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as DemoState
  } catch {
    // Storage unavailable or corrupt: start fresh.
  }
  return seed()
}

// Loaded on first use, never at import time: the real build imports this module too and must
// not read demo state or touch the clock.
let loaded: DemoState | null = null
const state = (): DemoState => {
  if (!loaded) {
    loaded = load()
    clock.set(loaded.offsetMs)
  }
  return loaded
}

/** Called once at startup in the demo build, so the saved clock applies before anything renders. */
export function initDemo() {
  state()
}

function save() {
  const current = state()
  current.offsetMs = clock.offsetMs
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    // Private mode: the demo still works, it just won't survive a reload.
  }
}

/** Moves the demo clock forward (to show the review window ending) and remembers it. */
export function advanceDemoClock(ms: number) {
  clock.advance(ms)
  save()
}

/** Puts the demo back to its starting point. */
export function resetDemo() {
  loaded = seed()
  clock.set(0)
  save()
}

// ---------- the contract's rules ----------

const find = (id: string) => {
  const order = state().orders.find((o) => o.id === id)
  if (!order) throw new ApiError('ORDER_NOT_FOUND', 'No order with this number exists')
  return order
}

function expectStatus(order: Order, ...allowed: OrderStatus[]) {
  if (!allowed.includes(order.status)) throw new ApiError('INVALID_STATUS', 'Not allowed in the current state')
}

/** Throws the same errors, in the same cases, as the contract would. */
function checkAction(order: Order, action: OrderAction, body: Record<string, string>) {
  const now = nowSeconds()
  switch (action) {
    case 'accept':
      return expectStatus(order, 'Funded')
    case 'cancel':
      expectStatus(order, 'Funded', 'Accepted')
      // After acceptance, the buyer can only cancel once the delivery deadline has passed.
      if (order.status === 'Accepted' && now <= order.deliveryDeadline) throw new ApiError('TOO_EARLY', 'Too early')
      return
    case 'deliver':
      return expectStatus(order, 'Accepted')
    case 'confirm':
      return expectStatus(order, 'Delivered')
    case 'claim':
      expectStatus(order, 'Delivered')
      if (now <= order.reviewDeadline) throw new ApiError('TOO_EARLY', 'Too early')
      return
    case 'dispute': {
      const reason = (body.reason ?? '').trim()
      if (!reason) throw new ApiError('MISSING_FIELD', '"reason" is required')
      if (reason.length > MAX_REASON_LENGTH) throw new ApiError('INVALID_REASON', 'reason is too long')
      expectStatus(order, 'Delivered')
      if (now > order.reviewDeadline) throw new ApiError('TOO_LATE', 'Too late')
      return
    }
    case 'resolve': {
      const amount = parseUsdc(body.farmerAmount ?? '')
      expectStatus(order, 'Disputed')
      // The cooperative can only rule up to the dispute deadline.
      if (now > order.disputeDeadline) throw new ApiError('TOO_LATE', 'Too late')
      if (amount > parseUsdc(order.amount)) throw new ApiError('INVALID_SPLIT', 'Split is larger than the order')
      return
    }
    case 'expire':
      // Settling by default is only possible once the cooperative's time has run out.
      expectStatus(order, 'Disputed')
      if (now <= order.disputeDeadline) throw new ApiError('TOO_EARLY', 'Too early')
      return
  }
}

const NEXT_STATUS: Record<OrderAction, OrderStatus> = {
  accept: 'Accepted',
  cancel: 'Refunded',
  deliver: 'Delivered',
  confirm: 'Released',
  claim: 'Released',
  dispute: 'Disputed',
  resolve: 'Resolved',
  expire: 'Resolved',
}

// ---------- amounts (7 decimals, like USDC on Stellar) ----------

function parseUsdc(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(value)
  if (!match) throw new ApiError('INVALID_AMOUNT', 'Not a valid USDC amount')
  const [, whole, fraction = ''] = match
  return BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, '0'))
}

function formatUsdc(value: bigint): string {
  const fraction = (value % 10_000_000n).toString().padStart(7, '0').replace(/0+$/, '')
  return fraction ? `${value / 10_000_000n}.${fraction}` : `${value / 10_000_000n}`
}

// ---------- the API surface ----------

// A built "transaction" is just a token; submitting it applies the change.
type Pending =
  | { kind: 'create'; input: CreateOrderInput }
  | { kind: 'action'; orderId: string; action: OrderAction; body: Record<string, string> }
const pending = new Map<string, Pending>()
let tokenCounter = 0
const issue = (p: Pending) => {
  const xdr = `demo-tx-${++tokenCounter}`
  pending.set(xdr, p)
  return { xdr }
}

const fakeHash = () => Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
const delay = () => new Promise((resolve) => setTimeout(resolve, 150)) // so progress messages are visible

export const demoApi = {
  async getOrder(id: string): Promise<Order> {
    await delay()
    return { ...find(id) }
  },

  async buildCreateOrder(input: CreateOrderInput): Promise<BuiltTransaction> {
    await delay()
    for (const party of [input.buyer, input.farmer, input.arbiter]) {
      if (!ADDRESS.test(party)) throw new ApiError('INVALID_ADDRESS', 'Not a valid account')
    }
    if (new Set([input.buyer, input.farmer, input.arbiter]).size !== 3) {
      throw new ApiError('INVALID_PARTIES', 'Buyer, farmer and arbiter must differ')
    }
    if (parseUsdc(input.amount) <= 0n) throw new ApiError('INVALID_AMOUNT', 'Amount must be positive')
    const deadline = Date.parse(input.deliveryDeadline)
    if (Number.isNaN(deadline) || deadline <= clock.now()) {
      throw new ApiError('INVALID_DEADLINE', 'The delivery deadline must be in the future')
    }
    const hours = input.reviewWindowHours
    if (!Number.isInteger(hours) || hours < 1 || hours > MAX_REVIEW_WINDOW_HOURS) {
      throw new ApiError('INVALID_DEADLINE', 'Invalid review window')
    }
    const days = input.disputeWindowDays ?? DEFAULT_DISPUTE_WINDOW_DAYS
    if (!Number.isInteger(days) || days < MIN_DISPUTE_WINDOW_DAYS || days > MAX_DISPUTE_WINDOW_DAYS) {
      throw new ApiError('INVALID_DEADLINE', 'Invalid dispute window')
    }
    return issue({ kind: 'create', input })
  },

  async buildAction(id: string, action: OrderAction, body: Record<string, string> = {}): Promise<BuiltTransaction> {
    await delay()
    checkAction(find(id), action, body)
    return issue({ kind: 'action', orderId: id, action, body })
  },

  async submit(signedXdr: string): Promise<SubmitResult> {
    await delay()
    const tx = pending.get(signedXdr)
    if (!tx) throw new ApiError('INVALID_TRANSACTION', 'Unknown transaction')
    pending.delete(signedXdr)

    if (tx.kind === 'create') {
      const { input } = tx
      const order: Order = {
        id: String(state().nextId++),
        buyer: input.buyer,
        farmer: input.farmer,
        arbiter: input.arbiter,
        amount: formatUsdc(parseUsdc(input.amount)),
        deliveryDeadline: Math.floor(Date.parse(input.deliveryDeadline) / 1000),
        reviewWindow: input.reviewWindowHours * 3600,
        reviewDeadline: 0,
        disputeWindow: (input.disputeWindowDays ?? DEFAULT_DISPUTE_WINDOW_DAYS) * DAY,
        disputeDeadline: 0,
        status: 'Funded',
      }
      state().orders.push(order)
      save()
      return { hash: fakeHash(), orderId: order.id }
    }

    // The state may have changed between building and submitting; check again, like the chain.
    const order = find(tx.orderId)
    checkAction(order, tx.action, tx.body)
    order.status = NEXT_STATUS[tx.action]
    if (tx.action === 'deliver') order.reviewDeadline = nowSeconds() + order.reviewWindow
    if (tx.action === 'dispute') order.disputeDeadline = nowSeconds() + order.disputeWindow
    save()
    return { hash: fakeHash() }
  },
}
