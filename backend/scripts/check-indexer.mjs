#!/usr/bin/env node
// Checks the order index: that it finds every order, follows changes, survives restarts and
// downtime, retries network failures, and serves GET /api/orders correctly. It uses a fake chain
// and a fake Stellar RPC, so it needs no network and no running backend.
//
//   cd backend && npm run build && node --no-warnings scripts/check-indexer.mjs

import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Keypair, nativeToScVal } from '@stellar/stellar-sdk'
import { createApp } from '../dist/app.js'
import { Indexer } from '../dist/indexer/indexer.js'
import { OrderIndex } from '../dist/indexer/orderIndex.js'
import { EscrowError, EscrowService } from '../dist/stellar/escrow.js'

// ---------- tiny harness ----------
let failed = 0
let total = 0
async function check(name, fn) {
  total++
  try {
    await fn()
    console.log(`ok    ${name}`)
  } catch (err) {
    failed++
    console.log(`FAIL  ${name}\n        ${String(err.message).split('\n').join('\n        ')}`)
  }
}
const show = (value) => JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? `${v}n` : v))
const eq = (actual, expected, what = 'value') => {
  const a = show(actual)
  const e = show(expected)
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`)
}

// ---------- accounts and orders ----------
// Real keys, because the API validates addresses properly (checksum included).
const addr = () => Keypair.random().publicKey()
const [ALICE, BOB, CARA, DAN, STRANGER] = [addr(), addr(), addr(), addr(), addr()]
const order = (id, buyer, farmer, arbiter, status = 'Funded') => ({
  id: String(id), buyer, farmer, arbiter, amount: '100', deliveryDeadline: 2_000_000_000,
  reviewWindow: 259_200, reviewDeadline: 0, disputeWindow: 604_800, disputeDeadline: 0, status,
})

// ---------- a fake chain, with events and pages of 2 ----------
class FakeChain {
  orders = new Map()
  ledger = 1000
  oldest = 900
  events = []
  getOrderCalls = []
  eventRequests = []
  down = false
  /** Reads of single orders fail, while the event feed keeps working. */
  readsDown = false
  unreadable = new Set()
  PAGE = 2

  add(o) { this.orders.set(BigInt(o.id), { ...o }); this.emit(o.id) }
  change(id, patch) { Object.assign(this.orders.get(BigInt(id)), patch); this.emit(id) }
  emit(id) { this.events.push({ ledger: ++this.ledger, id: BigInt(id) }) }

  async getOrder(id) {
    this.getOrderCalls.push(Number(id))
    if (this.down || this.readsDown) throw new EscrowError('RPC_UNAVAILABLE', 'down', 503)
    if (this.unreadable.has(Number(id))) throw new EscrowError('SIMULATION_FAILED', 'storage expired', 502)
    const found = this.orders.get(id)
    if (!found) throw new EscrowError('ORDER_NOT_FOUND', 'none', 404)
    return { ...found }
  }
  async ledgerRange() {
    if (this.down) throw new EscrowError('RPC_UNAVAILABLE', 'down', 503)
    return { latest: this.ledger, oldest: this.oldest }
  }
  async orderEvents(from) {
    this.eventRequests.push(from)
    if (this.down) throw new EscrowError('RPC_UNAVAILABLE', 'down', 503)
    const start = 'cursor' in from ? Number(from.cursor) : from.ledger
    const matching = this.events.filter((e) => e.ledger >= start)
    const page = matching.slice(0, this.PAGE)
    const full = page.length === this.PAGE
    const next = full ? page[page.length - 1].ledger + 1 : this.ledger
    return { orderIds: page.map((e) => e.id), cursor: String(next), latestLedger: this.ledger, caughtUp: !full && next >= this.ledger - 1 }
  }
}

const seeded = () => {
  const chain = new FakeChain()
  chain.add(order(1, ALICE, BOB, CARA, 'Released'))
  chain.add(order(2, ALICE, BOB, CARA, 'Funded'))
  chain.add(order(3, DAN, BOB, CARA, 'Delivered'))
  chain.events = [] // history before the indexer existed: it must not need it
  return chain
}
const indexer = (chain, db = new OrderIndex(), log = () => {}) => new Indexer(chain, db, { pollMs: 20, log })
const ids = (orders) => orders.map((o) => Number(o.id))

// ---------- the indexer ----------
await check('a fresh start finds every existing order without reading history', async () => {
  const chain = seeded()
  const ix = indexer(chain)
  await ix.syncOnce()
  eq(ix.index.count(), 3, 'orders indexed')
  eq(chain.getOrderCalls, [1, 2, 3, 4], 'orders read (4 does not exist, which ends the sequence)')
  eq(ix.synced, true, 'synced')
  eq(ix.indexedLedger, chain.ledger, 'indexed ledger')
})

await check('only orders named in events are re-read, and new orders are picked up', async () => {
  const chain = seeded()
  const ix = indexer(chain)
  await ix.syncOnce()
  chain.getOrderCalls.length = 0

  chain.change(2, { status: 'Accepted' })
  chain.add(order(4, CARA, BOB, DAN))
  await ix.syncOnce()

  eq(ix.index.get(2).status, 'Accepted', 'order 2 status')
  eq(ix.index.get(4)?.buyer, CARA, 'new order 4')
  eq(chain.getOrderCalls.sort(), [2, 4], 'orders read: nothing unchanged is touched')
})

await check('events spread over several pages are all applied', async () => {
  const chain = seeded()
  const ix = indexer(chain)
  await ix.syncOnce()
  for (let n = 4; n <= 10; n++) chain.add(order(n, ALICE, BOB, CARA))
  chain.eventRequests.length = 0
  await ix.syncOnce()
  eq(ix.index.count(), 10, 'orders indexed')
  if (chain.eventRequests.length < 4) throw new Error(`expected several pages, got ${chain.eventRequests.length}`)
})

await check('an account sees only its orders, newest first, with its role', async () => {
  const chain = seeded()
  chain.add(order(4, ALICE, DAN, CARA, 'Accepted'))
  const ix = indexer(chain)
  await ix.syncOnce()

  const alice = ix.index.ordersFor(ALICE, 100)
  eq(ids(alice), [4, 2, 1], 'alice: newest first')
  eq(alice.map((o) => o.role), ['buyer', 'buyer', 'buyer'], 'alice roles')
  eq(ix.index.ordersFor(BOB, 100).map((o) => o.role), ['farmer', 'farmer', 'farmer'], 'bob roles')
  eq(ix.index.ordersFor(CARA, 100).map((o) => o.role), ['arbiter', 'arbiter', 'arbiter', 'arbiter'], 'cara roles')
  eq(ids(ix.index.ordersFor(DAN, 100)), [4, 3], 'dan is a buyer and a farmer')
  eq(ids(ix.index.ordersFor(ALICE, 2)), [4, 2], 'limit applies')
  eq(ix.index.ordersFor(STRANGER, 100), [], 'a stranger has none')
})

await check('it resumes after a restart without re-reading finished orders', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'farmpay-index-'))
  try {
    const file = join(dir, 'index.sqlite')
    const chain = seeded()
    const first = indexer(chain, new OrderIndex(file))
    await first.syncOnce()
    first.index.close()

    // While the indexer is down an order moves on and a new one appears.
    chain.change(2, { status: 'Accepted' })
    chain.add(order(4, DAN, BOB, CARA))
    chain.getOrderCalls.length = 0

    const second = indexer(chain, new OrderIndex(file))
    await second.syncOnce()
    eq(second.index.get(2).status, 'Accepted', 'order 2 updated while away')
    eq(second.index.count(), 4, 'order 4 found')
    if (chain.getOrderCalls.includes(1)) throw new Error('finished order 1 was read again')
    eq(second.indexedLedger, chain.ledger, 'indexed ledger')
    second.index.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await check('downtime longer than the RPC keeps events loses nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'farmpay-index-'))
  try {
    const file = join(dir, 'index.sqlite')
    const chain = seeded()
    const first = indexer(chain, new OrderIndex(file))
    await first.syncOnce()
    first.index.close()

    // Much later: the order changed and then the RPC forgot the events that said so.
    chain.change(3, { status: 'Released' })
    chain.events = []
    chain.ledger = 600_000
    chain.oldest = 480_000

    const second = indexer(chain, new OrderIndex(file))
    await second.syncOnce()
    eq(second.index.get(3).status, 'Released', 'order 3 recovered without its event')
    const firstRequest = chain.eventRequests.at(-1)
    if ('ledger' in firstRequest && firstRequest.ledger < chain.oldest) throw new Error('asked for events the RPC no longer has')
    second.index.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await check('one unreadable order does not block the others', async () => {
  const chain = seeded()
  chain.unreadable.add(2)
  const logs = []
  const ix = indexer(chain, new OrderIndex(), (m) => logs.push(m))
  await ix.syncOnce()
  eq(ix.index.count(), 2, 'readable orders indexed')
  eq(ix.synced, true, 'synced')
  if (!logs.some((m) => m.includes('skipping order 2'))) throw new Error('the skip was not logged')
})

await check('a network failure is retried, and a missed change is not forgotten', async () => {
  const chain = seeded()
  const ix = indexer(chain)

  chain.down = true
  await ix.syncOnce().then(() => { throw new Error('should have failed') }, () => {})
  eq(ix.index.count(), 0, 'nothing indexed while down')
  eq(ix.synced, false, 'not synced')

  chain.down = false
  await ix.syncOnce()
  eq(ix.index.count(), 3, 'recovered')

  // The feed is down when a change happens: the event is simply read once it is back.
  chain.change(3, { status: 'Accepted' })
  chain.down = true
  await ix.syncOnce().then(() => { throw new Error('should have failed') }, () => {})
  chain.down = false
  await ix.syncOnce()
  eq(ix.index.get(3).status, 'Accepted', 'change applied after the feed came back')

  // The event is read, but reading the order fails: the change must survive until reads work.
  chain.change(3, { status: 'Disputed' })
  chain.readsDown = true
  await ix.syncOnce().then(() => { throw new Error('should have failed') }, () => {})
  chain.readsDown = false
  chain.events = [] // the event has been consumed and is gone: only the retry can apply the change
  await ix.syncOnce()
  eq(ix.index.get(3).status, 'Disputed', 'order 3 caught up on retry')
})

await check('the background loop recovers by itself and stops cleanly', async () => {
  const chain = seeded()
  chain.down = true
  const ix = indexer(chain)
  ix.start()
  await new Promise((r) => setTimeout(r, 120))
  eq(ix.synced, false, 'still down')
  if (!ix.lastError) throw new Error('the failure was not recorded')

  chain.down = false
  for (let i = 0; i < 150 && !ix.synced; i++) await new Promise((r) => setTimeout(r, 20))
  eq(ix.synced, true, 'recovered')
  eq(ix.lastError, undefined, 'error cleared')

  await ix.stop()
  const calls = chain.getOrderCalls.length
  await new Promise((r) => setTimeout(r, 100))
  eq(chain.getOrderCalls.length, calls, 'no work after stop')
})

// ---------- the HTTP API ----------
async function withApp(indexerOrNone, run) {
  const app = createApp({ escrow: {}, escrowContractId: 'C-TEST', indexer: indexerOrNone, logRequests: false })
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)) })
  const base = `http://localhost:${server.address().port}/api`
  const get = async (path) => { const r = await fetch(base + path); return { status: r.status, body: await r.json() } }
  try { await run(get) } finally { await new Promise((r) => server.close(r)) }
}

const readyIndexer = async () => { const ix = indexer(seeded()); await ix.syncOnce(); return ix }

await check('GET /api/orders?party= returns the account\'s orders with its role', async () => {
  await withApp(await readyIndexer(), async (get) => {
    const { status, body } = await get(`/orders?party=${ALICE}`)
    eq(status, 200, 'status')
    eq(body.orders.map((o) => [o.id, o.role]), [['2', 'buyer'], ['1', 'buyer']], 'orders')
    eq(body.synced, true, 'synced flag')
    if (typeof body.indexedLedger !== 'number') throw new Error('no indexedLedger')
    eq((await get(`/orders?party=${STRANGER}`)).body.orders, [], 'a stranger has none')
    eq((await get(`/orders?party=${ALICE}&limit=1`)).body.orders.length, 1, 'limit')
  })
})

await check('bad requests to GET /api/orders are 400s with a clear code', async () => {
  await withApp(await readyIndexer(), async (get) => {
    for (const [path, code] of [
      ['/orders', 'MISSING_FIELD'],
      ['/orders?party=nope', 'INVALID_ADDRESS'],
      [`/orders?party=${ALICE}&limit=0`, 'INVALID_LIMIT'],
      [`/orders?party=${ALICE}&limit=501`, 'INVALID_LIMIT'],
      [`/orders?party=${ALICE}&limit=abc`, 'INVALID_LIMIT'],
      [`/orders?party=${ALICE}&party=${BOB}`, 'MISSING_FIELD'],
    ]) {
      const { status, body } = await get(path)
      eq([status, body.error?.code], [400, code], path)
    }
  })
})

await check('without an index the endpoint says so (503), and /health reports the index', async () => {
  await withApp(undefined, async (get) => {
    eq((await get(`/orders?party=${ALICE}`)).body.error.code, 'INDEX_UNAVAILABLE', 'no index')
    eq((await get('/health')).body.index, null, 'health without index')
  })
  await withApp(await readyIndexer(), async (get) => {
    const { index } = (await get('/health')).body
    eq([index.synced, index.orders], [true, 3], 'health with index')
  })
})

// ---------- reading events from the real RPC's wire format ----------
// A fake Stellar RPC that answers getEvents and getHealth, so the adapter that decodes events
// is tested against the shapes the network really sends (including paging by cursor).
const topic = (name, id) => [nativeToScVal(name, { type: 'symbol' }), nativeToScVal(BigInt(id), { type: 'u64' })].map((v) => v.toXDR('base64'))
const toid = (ledger) => `${(BigInt(ledger) << 32n).toString().padStart(19, '0')}-0000000001`
// The real RPC leaves `inSuccessfulContractCall` out of events (found by running against testnet),
// so events here omit it too, except the one that must be treated as failed.
const rawEvent = (ledger, name, id, ok) => ({
  type: 'contract', ledger, ledgerClosedAt: '2026-11-02T00:00:00Z', transactionIndex: 1, operationIndex: 0,
  ...(ok === undefined ? {} : { inSuccessfulContractCall: ok }), txHash: 'a'.repeat(64), id: toid(ledger), contractId: 'CDKKY5RXPHH7Y56HTVF6Y3NUWAA54ZIU6AU2HGYMWXDR7IKU7EWSA5GS',
  topic: topic(name, id), value: nativeToScVal(null).toXDR('base64'),
})

await check('the event reader decodes the network\'s events and pages until caught up', async () => {
  const requests = []
  const rpc = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const { id, method, params } = JSON.parse(body)
      const reply = (result) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id, result })) }
      if (method === 'getHealth') return reply({ status: 'healthy', latestLedger: 500, oldestLedger: 100, ledgerRetentionWindow: 400 })
      requests.push(params)
      // The real protocol puts the cursor and limit under `pagination`.
      const cursor = params.pagination?.cursor
      const base = { latestLedger: 500, oldestLedger: 100, latestLedgerCloseTime: '1', oldestLedgerCloseTime: '1' }
      if (!cursor) {
        // First page: full (2 events = the limit), so there is more. One is another event type,
        // one is from a failed call; neither may count.
        return reply({ ...base, cursor: toid(300), events: [rawEvent(210, 'status_changed', 7), rawEvent(211, 'dispute_opened', 8)] })
      }
      if (cursor === toid(300)) {
        return reply({ ...base, cursor: toid(450), events: [rawEvent(400, 'status_changed', 9), rawEvent(401, 'status_changed', 10, false)] })
      }
      // Last page: a short one that reaches the newest ledger.
      return reply({ ...base, cursor: toid(500), events: [rawEvent(499, 'status_changed', 7)] })
    })
  })
  await new Promise((r) => rpc.listen(0, '127.0.0.1', r))
  try {
    const service = new EscrowService(`http://127.0.0.1:${rpc.address().port}`, 'Test SDF Network ; September 2015', 'CDKKY5RXPHH7Y56HTVF6Y3NUWAA54ZIU6AU2HGYMWXDR7IKU7EWSA5GS')
    eq(await service.ledgerRange(), { latest: 500, oldest: 100 }, 'ledger range')

    const first = await service.orderEvents({ ledger: 200 }, 2)
    eq(first.orderIds, [7n], 'page 1 ids (dispute_opened is ignored)')
    eq(first.caughtUp, false, 'a full page means there may be more')

    const second = await service.orderEvents({ cursor: first.cursor }, 2)
    eq(second.orderIds, [9n], 'page 2 ids (an event marked as a failed call is ignored; one with no flag counts)')
    eq(second.caughtUp, false, 'still not at the newest ledger')

    const third = await service.orderEvents({ cursor: second.cursor }, 2)
    eq(third.orderIds, [7n], 'page 3 ids')
    eq(third.caughtUp, true, 'a short page that reaches the newest ledger is the end')
    eq([requests[0].startLedger, requests[0].pagination?.cursor], [200, undefined], 'the first request starts from a ledger')
    eq([requests[1].startLedger, requests[1].pagination.cursor], [undefined, first.cursor], 'later requests continue from the cursor')
    eq(requests[0].filters[0].contract_ids ?? requests[0].filters[0].contractIds, ['CDKKY5RXPHH7Y56HTVF6Y3NUWAA54ZIU6AU2HGYMWXDR7IKU7EWSA5GS'], 'only this contract\'s events are asked for')
  } finally {
    await new Promise((r) => rpc.close(r))
  }
})

console.log(`\n${total - failed}/${total} checks passed`)
process.exit(failed ? 1 : 0)
