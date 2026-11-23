// Tests the orders router with a fake escrow service, so nothing touches the network.
//
//   cd backend && npm test        (builds first; or `node --test test/` after `npm run build`)
//
// The fake records what the router asked the contract layer to do: which method, who signs, and
// with what arguments. That is the part of the router worth pinning down.

import assert from 'node:assert/strict'
import { before, beforeEach, after, describe, it } from 'node:test'
import { Keypair, scValToNative } from '@stellar/stellar-sdk'
import { createApp } from '../dist/app.js'
import { EscrowError } from '../dist/stellar/escrow.js'

const account = () => Keypair.random().publicKey()
const BUYER = account()
const FARMER = account()
const ARBITER = account()
const STRANGER = account()

const order = (id = '7') => ({ id, buyer: BUYER, farmer: FARMER, arbiter: ARBITER })

/** Stands in for EscrowService and remembers every call. */
class FakeEscrow {
  calls = []
  submitResult = { hash: 'h'.repeat(64), returnValue: undefined }
  missing = new Set()

  async getOrder(id) {
    this.calls.push(['getOrder', id])
    if (this.missing.has(id)) throw new EscrowError('ORDER_NOT_FOUND', 'no such order', 404)
    return order(String(id))
  }
  async buildOrderCall(signer, method, id, args = []) {
    this.calls.push(['buildOrderCall', { signer, method, id, args: args.map((a) => scValToNative(a)) }])
    return `xdr:${method}`
  }
  async buildCreateOrder(params) {
    this.calls.push(['buildCreateOrder', params])
    return 'xdr:create_order'
  }
  async submit(signedXdr) {
    this.calls.push(['submit', signedXdr])
    return this.submitResult
  }
  /** The calls to the contract layer, without the reads. */
  get built() {
    return this.calls.filter(([name]) => name !== 'getOrder').map(([, detail]) => detail)
  }
}

let escrow
let server
let base

before(async () => {
  escrow = new FakeEscrow()
  const app = createApp({ escrow, logRequests: false })
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${server.address().port}/api`
})
after(() => server.close())
beforeEach(() => {
  escrow.calls = []
  escrow.submitResult = { hash: 'h'.repeat(64), returnValue: undefined }
  escrow.missing.clear()
})

async function post(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body ?? {}),
  })
  return { status: res.status, body: await res.json() }
}

describe('order actions: the right contract method, signed by the right party', () => {
  const cases = [
    ['accept', 'accept_order', FARMER],
    ['cancel', 'cancel_order', BUYER],
    ['deliver', 'mark_delivered', FARMER],
    ['confirm', 'confirm_delivery', BUYER],
    ['claim', 'claim_payment', FARMER],
    ['expire', 'expire_dispute', BUYER],
  ]
  for (const [action, method, signer] of cases) {
    it(`${action} builds ${method} for the ${signer === FARMER ? 'farmer' : 'buyer'} of the order`, async () => {
      const res = await post(`/orders/7/${action}`)
      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { orderId: '7', action, xdr: `xdr:${method}` })
      assert.deepEqual(escrow.built, [{ signer, method, id: 7n, args: [] }])
    })
  }

  it('dispute is signed by the buyer and carries the trimmed reason', async () => {
    await post('/orders/7/dispute', { reason: '  Half the crates were spoiled  ' })
    assert.deepEqual(escrow.built, [
      { signer: BUYER, method: 'open_dispute', id: 7n, args: ['Half the crates were spoiled'] },
    ])
  })

  it('resolve is signed by the arbiter and carries the farmer share in the smallest unit', async () => {
    await post('/orders/7/resolve', { farmerAmount: '1840.5' })
    assert.deepEqual(escrow.built, [
      { signer: ARBITER, method: 'resolve_dispute', id: 7n, args: [18_405_000_000n] },
    ])
  })

  it('the signer comes from the order itself, not from the request', async () => {
    await post('/orders/7/accept', { farmer: STRANGER, buyer: STRANGER, signer: STRANGER })
    assert.equal(escrow.built[0].signer, FARMER)
  })
})

describe('claim and expire: anyone may trigger them', () => {
  it('claim uses `caller` when provided', async () => {
    await post('/orders/7/claim', { caller: STRANGER })
    assert.equal(escrow.built[0].signer, STRANGER)
  })
  it('claim falls back to the farmer without one', async () => {
    await post('/orders/7/claim', {})
    assert.equal(escrow.built[0].signer, FARMER)
  })
  it('expire uses `caller` when provided, else the buyer', async () => {
    await post('/orders/7/expire', { caller: STRANGER })
    await post('/orders/7/expire', {})
    assert.deepEqual(
      escrow.built.map((b) => b.signer),
      [STRANGER, BUYER],
    )
  })
  it('a malformed `caller` is rejected', async () => {
    const res = await post('/orders/7/claim', { caller: 'not-an-account' })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'INVALID_ADDRESS')
    assert.deepEqual(escrow.built, [])
  })
  it('every other action ignores `caller`', async () => {
    for (const action of ['accept', 'cancel', 'deliver', 'confirm']) await post(`/orders/7/${action}`, { caller: STRANGER })
    assert.ok(escrow.built.every((b) => b.signer !== STRANGER))
  })
})

describe('validation returns the documented codes, before any contract call', () => {
  const cases = [
    ['order id is not a number', '/orders/abc/accept', {}, 400, 'INVALID_ORDER_ID'],
    ['order id is negative', '/orders/-1/accept', {}, 400, 'INVALID_ORDER_ID'],
    ['order id is larger than a u64', '/orders/18446744073709551616/accept', {}, 400, 'INVALID_ORDER_ID'],
    ['unknown action', '/orders/7/explode', {}, 404, 'NOT_FOUND'],
    ['body is an array', '/orders/7/accept', '[1]', 400, 'INVALID_BODY'],
    ['body is null (the JSON parser refuses it)', '/orders/7/accept', 'null', 400, 'INVALID_JSON'],
    ['body is not JSON', '/orders/7/accept', '{nope', 400, 'INVALID_JSON'],
    ['dispute without a reason', '/orders/7/dispute', {}, 400, 'MISSING_FIELD'],
    ['dispute with a blank reason', '/orders/7/dispute', { reason: '   ' }, 400, 'MISSING_FIELD'],
    ['dispute reason over 500 characters', '/orders/7/dispute', { reason: 'x'.repeat(501) }, 400, 'INVALID_REASON'],
    ['resolve without an amount', '/orders/7/resolve', {}, 400, 'MISSING_FIELD'],
    ['resolve with a negative amount', '/orders/7/resolve', { farmerAmount: '-1' }, 400, 'INVALID_AMOUNT'],
    ['resolve with too many decimals', '/orders/7/resolve', { farmerAmount: '1.00000001' }, 400, 'INVALID_AMOUNT'],
  ]
  for (const [name, path, body, status, code] of cases) {
    it(`${name}: ${status} ${code}`, async () => {
      const res = await post(path, body)
      assert.equal(res.status, status)
      assert.equal(res.body.error.code, code)
      assert.deepEqual(escrow.calls, [], 'no RPC call may be spent on a bad request')
    })
  }

  it('an order that does not exist is a 404 and nothing is built', async () => {
    escrow.missing.add(9n)
    const res = await post('/orders/9/accept')
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'ORDER_NOT_FOUND')
    assert.deepEqual(escrow.built, [])
  })
})

describe('create order', () => {
  const valid = () => ({
    buyer: BUYER,
    farmer: FARMER,
    arbiter: ARBITER,
    amount: '250.5',
    deliveryDeadline: new Date(Date.now() + 7 * 864e5).toISOString(),
    reviewWindowHours: 72,
  })

  it('passes the parsed order to the contract layer, with a 7 day dispute window by default', async () => {
    const res = await post('/orders', valid())
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { action: 'create', xdr: 'xdr:create_order' })
    const [params] = escrow.built
    assert.equal(params.buyer, BUYER)
    assert.equal(params.amount, 2_505_000_000n)
    assert.equal(params.reviewWindow, 72 * 3600)
    assert.equal(params.disputeWindow, 7 * 86400)
  })

  const bad = [
    ['an invalid farmer address', { farmer: 'nope' }, 'INVALID_ADDRESS'],
    ['a zero amount', { amount: '0' }, 'INVALID_AMOUNT'],
    ['a deadline in the past', { deliveryDeadline: '2020-01-01T00:00:00Z' }, 'INVALID_DEADLINE'],
    ['a deadline that is not a date', { deliveryDeadline: 'tomorrow-ish' }, 'INVALID_DEADLINE'],
    ['a review window of 0 hours', { reviewWindowHours: 0 }, 'INVALID_DEADLINE'],
    ['a fractional review window', { reviewWindowHours: 1.5 }, 'INVALID_DEADLINE'],
    ['a dispute window of 0 days', { disputeWindowDays: 0 }, 'INVALID_DEADLINE'],
    ['a dispute window of 31 days', { disputeWindowDays: 31 }, 'INVALID_DEADLINE'],
  ]
  for (const [name, change, code] of bad) {
    it(`rejects ${name} with ${code}`, async () => {
      const res = await post('/orders', { ...valid(), ...change })
      assert.equal(res.status, 400)
      assert.equal(res.body.error.code, code)
      assert.deepEqual(escrow.calls, [])
    })
  }
})

describe('POST /transactions', () => {
  const signedXdr = 'AAAA'

  it('returns the hash, and the order id only when the contract returned one', async () => {
    escrow.submitResult = { hash: 'a'.repeat(64), returnValue: 42n }
    assert.deepEqual((await post('/transactions', { signedXdr })).body, { hash: 'a'.repeat(64), orderId: '42' })

    escrow.submitResult = { hash: 'b'.repeat(64), returnValue: undefined }
    assert.deepEqual((await post('/transactions', { signedXdr })).body, { hash: 'b'.repeat(64) })
  })

  it('does not mistake other return values for an order id', async () => {
    for (const returnValue of [true, 'x', 5, null]) {
      escrow.submitResult = { hash: 'c'.repeat(64), returnValue }
      assert.deepEqual((await post('/transactions', { signedXdr })).body, { hash: 'c'.repeat(64) })
    }
  })

  it('an order id of 0 is still an order id', async () => {
    escrow.submitResult = { hash: 'd'.repeat(64), returnValue: 0n }
    assert.equal((await post('/transactions', { signedXdr })).body.orderId, '0')
  })

  it('requires signedXdr', async () => {
    const res = await post('/transactions', {})
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'MISSING_FIELD')
    assert.deepEqual(escrow.calls, [])
  })

  it('passes a contract-layer error through in the standard format', async () => {
    escrow.submit = async () => {
      throw new EscrowError('TRANSACTION_EXPIRED', 'prepare it again', 409)
    }
    const res = await post('/transactions', { signedXdr })
    assert.equal(res.status, 409)
    assert.deepEqual(res.body, { error: { code: 'TRANSACTION_EXPIRED', message: 'prepare it again' } })
  })
})
