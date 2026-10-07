import { Router, type NextFunction, type Request, type Response } from 'express'
import { StrKey, nativeToScVal, type xdr } from '@stellar/stellar-sdk'
import { EscrowError, EscrowService, type Order, parseUsdc } from '../stellar/escrow.js'

type Role = 'buyer' | 'farmer' | 'arbiter'

interface ActionSpec {
  method: string
  signer: Role
  args?: (body: Record<string, unknown>) => xdr.ScVal[]
}

// One endpoint per contract method; `signer` is the order party whose wallet signs.
const ACTIONS: Record<string, ActionSpec> = {
  accept: { method: 'accept_order', signer: 'farmer' },
  cancel: { method: 'cancel_order', signer: 'buyer' },
  deliver: { method: 'mark_delivered', signer: 'farmer' },
  confirm: { method: 'confirm_delivery', signer: 'buyer' },
  claim: { method: 'claim_payment', signer: 'farmer' },
  dispute: {
    method: 'open_dispute',
    signer: 'buyer',
    args: (body) => [nativeToScVal(requireString(body, 'reason'), { type: 'string' })],
  },
  resolve: {
    method: 'resolve_dispute',
    signer: 'arbiter',
    args: (body) => [nativeToScVal(parseUsdc(requireString(body, 'farmerAmount')), { type: 'i128' })],
  },
}

export function ordersRouter(escrow: EscrowService): Router {
  const router = Router()

  router.post(
    '/orders',
    handle(async (req, res) => {
      const body = req.body ?? {}
      const deadline = Date.parse(requireString(body, 'deliveryDeadline'))
      const reviewWindowHours = Number(body.reviewWindowHours)
      if (Number.isNaN(deadline)) {
        throw new EscrowError('INVALID_DEADLINE', 'deliveryDeadline must be an ISO 8601 date')
      }
      if (!Number.isInteger(reviewWindowHours) || reviewWindowHours <= 0) {
        throw new EscrowError('INVALID_DEADLINE', 'reviewWindowHours must be a positive integer')
      }

      const xdr = await escrow.buildCreateOrder({
        buyer: requireAccount(body, 'buyer'),
        farmer: requireAccount(body, 'farmer'),
        arbiter: requireAccount(body, 'arbiter'),
        amount: parseUsdc(requireString(body, 'amount')),
        deliveryDeadline: Math.floor(deadline / 1000),
        reviewWindow: reviewWindowHours * 3600,
      })
      res.json({ action: 'create', xdr })
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

      const orderId = parseOrderId(req.params.orderId)
      const order = await escrow.getOrder(orderId)
      const body = req.body ?? {}
      // claim_payment needs no particular signer; anyone may pay the fee to trigger it.
      const signer =
        req.params.action === 'claim' && body.caller ? requireAccount(body, 'caller') : partyOf(order, spec.signer)

      const xdr = await escrow.buildOrderCall(signer, spec.method, orderId, spec.args?.(body))
      res.json({ orderId: order.id, action: req.params.action, xdr })
    }),
  )

  router.post(
    '/transactions',
    handle(async (req, res) => {
      const { hash, returnValue } = await escrow.submit(requireString(req.body ?? {}, 'signedXdr'))
      // create_order returns the new order id; other methods return nothing.
      const orderId = typeof returnValue === 'bigint' ? returnValue.toString() : undefined
      res.json({ hash, ...(orderId && { orderId }) })
    }),
  )

  return router
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof EscrowError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } })
    return
  }
  console.error(err)
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } })
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
  if (!/^\d+$/.test(value)) throw new EscrowError('INVALID_ORDER_ID', 'orderId must be a positive integer')
  return BigInt(value)
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
