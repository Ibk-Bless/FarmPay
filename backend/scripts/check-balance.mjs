#!/usr/bin/env node
// Checks GET /api/accounts/:address/balance against a fake Stellar RPC that answers the escrow's
// token() and the token's balance() the way the real contracts do.
//
//   cd backend && npm run build && node scripts/check-balance.mjs
//
// Needs no network access.

import { createServer } from 'node:http'
import { Address, Keypair, Networks, SorobanDataBuilder, StrKey, nativeToScVal } from '@stellar/stellar-sdk'
import { createApp } from '../dist/app.js'
import { EscrowService } from '../dist/stellar/escrow.js'

const ESCROW = 'CBEZZ7PQPDQWRMZUSBI3CPB55RDPLIUF2D4NLMFKXKQO4CNAOG34OGKS'
const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const HAS_USDC = Keypair.random().publicKey()
const NO_TRUSTLINE = Keypair.random().publicKey()
const BALANCES = { [HAS_USDC]: 18405000000n, [NO_TRUSTLINE]: 0n }

let mode = 'up'
const calls = []

const fakeRpc = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    if (mode === 'down') return req.socket.destroy()
    const { id, method, params } = JSON.parse(body || '{}')
    const reply = (result) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result }))
    }
    if (method !== 'simulateTransaction') return req.socket.destroy()

    // The transaction is opaque XDR, but the contract id, function name and account appear in it as
    // plain bytes, which is enough to tell the calls apart.
    const raw = Buffer.from(params.transaction, 'base64')
    const has = (bytes) => raw.includes(Buffer.from(bytes))
    const contract = has(StrKey.decodeContract(ESCROW)) ? ESCROW : has(StrKey.decodeContract(TOKEN)) ? TOKEN : ''
    const name = has('balance') ? 'balance' : has('token') ? 'token' : ''
    calls.push(`${contract === ESCROW ? 'escrow' : 'token'}.${name}`)

    let value
    if (contract === ESCROW && name === 'token') value = new Address(TOKEN).toScVal()
    else if (contract === TOKEN && name === 'balance') {
      const account = Object.keys(BALANCES).find((a) => has(StrKey.decodeEd25519PublicKey(a)))
      value = nativeToScVal(BALANCES[account] ?? 0n, { type: 'i128' })
    } else return reply({ error: 'unexpected call', latestLedger: 100 })
    reply({
      latestLedger: 100,
      minResourceFee: '100',
      transactionData: new SorobanDataBuilder().build().toXDR('base64'),
      results: [{ auth: [], xdr: value.toXDR('base64') }],
    })
  })
})
await new Promise((resolve) => fakeRpc.listen(0, '127.0.0.1', resolve))

const escrow = new EscrowService(`http://127.0.0.1:${fakeRpc.address().port}`, Networks.TESTNET, ESCROW)
const app = createApp({ escrow, logRequests: false })
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
const get = async (path) => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`)
  return { status: res.status, body: await res.json() }
}

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`)
  if (!ok) failed++
}

let r = await get(`/accounts/${HAS_USDC}/balance`)
check('an account with USDC gets its balance as a decimal string', r.status === 200 && r.body.balance === '1840.5', JSON.stringify(r))
r = await get(`/accounts/${NO_TRUSTLINE}/balance`)
check('an account without a trustline gets "0"', r.status === 200 && r.body.balance === '0', JSON.stringify(r))
check('the token is looked up once, then remembered', calls.filter((c) => c === 'escrow.token').length === 1, calls.join(','))
check('the balance is read from the token contract', calls.includes('token.balance'))

for (const bad of ['nope', 'C' + 'A'.repeat(55), HAS_USDC.slice(0, -1) + 'A']) {
  r = await get(`/accounts/${bad}/balance`)
  check(`invalid address "${bad.slice(0, 12)}…" is a 400 INVALID_ADDRESS`, r.status === 400 && r.body.error?.code === 'INVALID_ADDRESS', JSON.stringify(r))
}

mode = 'down'
r = await get(`/accounts/${NO_TRUSTLINE}/balance`)
check('RPC down is a 503 RPC_UNAVAILABLE, not a balance of 0', r.status === 503 && r.body.error?.code === 'RPC_UNAVAILABLE', JSON.stringify(r))

console.log(failed ? `\n${failed} check(s) failed` : '\nall balance checks passed')
server.close()
fakeRpc.close()
process.exit(failed ? 1 : 0)
