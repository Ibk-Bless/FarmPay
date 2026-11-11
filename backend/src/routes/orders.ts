import { Router, type NextFunction, type Request, type Response } from 'express'
import { StrKey, nativeToScVal, type xdr } from '@stellar/stellar-sdk'
import { EscrowError, EscrowService, type Order, parseUsdc } from '../stellar/escrow.js'
import type { Indexer } from '../indexer/indexer.js'

type Role = 'buyer' | 'farmer' | 'arbiter'

// Limits keep every value inside what the contract can encode, and keep on-chain data small.
const MAX_ORDER_ID = 2n ** 64n - 1n // u64
const MAX_REVIEW_WINDOW_HOURS = 24 * 365
// The contract enforces 1 to 30 days; checking here gives a clear error before any network call.
const MIN_DISPUTE_WINDOW_DAYS = 1
const MAX_DISPUTE_WINDOW_DAYS = 30
const DEFAULT_DISPUTE_WINDOW_DAYS = 7
const MAX_REASON_LENGTH = 500
const DEFAULT_LIST_LIMIT = 100
const MAX_LIST_LIMIT = 500

interface ActionSpec {
  method: string
  signer: Role
  /** The contract needs no signature from a party, so any account may pay the fee (`caller`). */
  anyone?: boolean
  args?: (body: Record<string, unknown>) => xdr.ScVal[]
}

// One endpoint per contract method; `signer` is the order party whose wallet signs.
const ACTIONS: Record<string, ActionSpec> = {
  accept: { method: 'accept_order', signer: 'farmer' },
  cancel: { method: 'cancel_order', signer: 'buyer' },
  deliver: { method: 'mark_delivered', signer: 'farmer' },
  confirm: { method: 'confirm_delivery', signer: 'buyer' },
  claim: { method: 'claim_payment', signer: 'farmer', anyone: true },
  dispute: {
    method: 'open_dispute',
    signer: 'buyer',
    args: (body) => [nativeToScVal(parseReason(body), { type: 'string' })],
  },
  // Settles a dispute the arbiter did not rule on in time; like `claim`, anyone may trigger it.
  expire: { method: 'expire_dispute', signer: 'buyer', anyone: true },
  resolve: {
    method: 'resolve_dispute',
    signer: 'arbiter',
    args: (body) => [nativeToScVal(parseUsdc(requireString(body, 'farmerAmount')), { type: 'i128' })],
  },
}

export function ordersRouter(escrow: EscrowService, indexer?: Indexer): Router {
  const router = Router()

  router.post(
    '/orders',
    handle(async (req, res) => {
      const body = requireObject(req.body)
      const deadline = Date.parse(requireString(body, 'deliveryDeadline'))
      const reviewWindowHours = body.reviewWindowHours
      if (Number.isNaN(deadline)) {
        throw new EscrowError('INVALID_DEADLINE', 'deliveryDeadline must be an ISO 8601 date')
      }
      if (deadline <= Date.now()) {
        throw new EscrowError('INVALID_DEADLINE', 'deliveryDeadline must be in the future')
      }
      if (
        typeof reviewWindowHours !== 'number' ||
        !Number.isInteger(reviewWindowHours) ||
        reviewWindowHours < 1 ||
        reviewWindowHours > MAX_REVIEW_WINDOW_HOURS
      ) {
        throw new EscrowError(
          'INVALID_DEADLINE',
          `reviewWindowHours must be a whole number between 1 and ${MAX_REVIEW_WINDOW_HOURS}`,
        )
      }

      const disputeWindowDays = body.disputeWindowDays ?? DEFAULT_DISPUTE_WINDOW_DAYS
      if (
        typeof disputeWindowDays !== 'number' ||
        !Number.isInteger(disputeWindowDays) ||
        disputeWindowDays < MIN_DISPUTE_WINDOW_DAYS ||
        disputeWindowDays > MAX_DISPUTE_WINDOW_DAYS
      ) {
        throw new EscrowError(
          'INVALID_DEADLINE',
          `disputeWindowDays must be a whole number between ${MIN_DISPUTE_WINDOW_DAYS} and ${MAX_DISPUTE_WINDOW_DAYS}`,
        )
      }

      const xdr = await escrow.buildCreateOrder({
        buyer: requireAccount(body, 'buyer'),
        farmer: requireAccount(body, 'farmer'),
        arbiter: requireAccount(body, 'arbiter'),
        amount: parseUsdc(requireString(body, 'amount')),
        deliveryDeadline: Math.floor(deadline / 1000),
        reviewWindow: reviewWindowHours * 3600,
        disputeWindow: disputeWindowDays * 24 * 3600,
      })
      res.json({ action: 'create', xdr })
    }),
  )

  // Which orders is this account part of? Answered from the local index, never from the chain.
  router.get(
    '/orders',
    handle(async (req, res) => {
      if (!indexer) throw new EscrowError('INDEX_UNAVAILABLE', 'The order index is not running', 503)
      const query = req.query as Record<string, unknown>
      const party = requireAccount(query, 'party')
      const limit = query.limit === undefined ? DEFAULT_LIST_LIMIT : Number(query.limit)
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
        throw new EscrowError('INVALID_LIMIT', `limit must be a whole number from 1 to ${MAX_LIST_LIMIT}`)
      }
      res.json({
        orders: indexer.index.ordersFor(party, limit),
        // Lets a client say "up to date as of ledger N", and tell loading from empty.
        indexedLedger: indexer.indexedLedger,
        synced: indexer.synced,
      })
    }),
  )

  // The USDC an account holds, so the app can warn before a transaction would fail for lack of it.
  router.get(
    '/accounts/:address/balance',
    handle(async (req, res) => {
      const account = requireAccount({ address: req.params.address }, 'address')
      res.json({ balance: await escrow.getBalance(account) })
    }),
  )

  router.get(
    '/orders/:orderId',
    handle(async (req, res) => {
      res.json(await escrow.getOrder(parseOrderId(req.params.orderId)))
    }),
  )

  router.post(
    '/orders/:orderId/:action',
    handle(async (req, res) => {
      const spec = ACTIONS[req.params.action]
      if (!spec) throw new EscrowError('NOT_FOUND', `Unknown action "${req.params.action}"`, 404)

      // Validate everything the client sent before spending an RPC call on it.
      const orderId = parseOrderId(req.params.orderId)
      const body = requireObject(req.body)
      const args = spec.args?.(body)
      const caller = spec.anyone && body.caller ? requireAccount(body, 'caller') : undefined

      const order = await escrow.getOrder(orderId)
      // claim and expire need no particular signer; anyone may pay the fee to trigger them.
      const signer = caller ?? partyOf(order, spec.signer)

      const xdr = await escrow.buildOrderCall(signer, spec.method, orderId, args)
      res.json({ orderId: order.id, action: req.params.action, xdr })
    }),
  )

  router.post(
    '/transactions',
    handle(async (req, res) => {
      const { hash, returnValue } = await escrow.submit(requireString(requireObject(req.body), 'signedXdr'))
      // create_order returns the new order id; other methods return nothing.
      const orderId = typeof returnValue === 'bigint' ? returnValue.toString() : undefined
      res.json({ hash, ...(orderId && { orderId }) })
    }),
  )

  return router
}

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next)
  }
}

function partyOf(order: Order, role: Role): string {
  return order[role]
}

function parseOrderId(value: string): bigint {
  if (!/^\d+$/.test(value) || BigInt(value) > MAX_ORDER_ID) {
    throw new EscrowError('INVALID_ORDER_ID', 'orderId must be a positive integer')
  }
  return BigInt(value)
}

function parseReason(body: Record<string, unknown>): string {
  const reason = requireString(body, 'reason').trim()
  if (reason.length > MAX_REASON_LENGTH) {
    throw new EscrowError('INVALID_REASON', `reason must be at most ${MAX_REASON_LENGTH} characters`)
  }
  return reason
}

/** Request bodies must be JSON objects; arrays, strings and null are rejected up front. */
function requireObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new EscrowError('INVALID_BODY', 'Request body must be a JSON object')
  }
  return body as Record<string, unknown>
}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new EscrowError('MISSING_FIELD', `"${field}" is required`)
  }
  return value
}

function requireAccount(body: Record<string, unknown>, field: string): string {
  const value = requireString(body, field)
  if (!StrKey.isValidEd25519PublicKey(value)) {
    throw new EscrowError('INVALID_ADDRESS', `"${field}" must be a Stellar account address (G...)`)
  }
  return value
}
