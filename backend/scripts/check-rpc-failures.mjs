#!/usr/bin/env node
// Checks what the API tells users when the Stellar network misbehaves. It starts a fake Stellar
// RPC that can be told to fail in specific ways, starts the real backend against it, and verifies
// each failure comes back as a clear, actionable error instead of a 500 or a misleading message.
//
//   cd backend && npm run build && node scripts/check-rpc-failures.mjs
//
// Needs no network access and no running backend.

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import {
  Account, BASE_FEE, Contract, Keypair, Networks, TransactionBuilder, nativeToScVal, xdr,
} from '@stellar/stellar-sdk'

const ESCROW = 'CBEZZ7PQPDQWRMZUSBI3CPB55RDPLIUF2D4NLMFKXKQO4CNAOG34OGKS'
const BUYER = 'GBKXCOYK6ITIUKJHJVVDUVEWZRWGAYMDRVTQQQK2HHALDYKCV66EL3MC'
const FARMER = 'GBJVOAZGITFHHNITKEBZFJXQO6I45XDF37ISY6L7K3XRNTC7X7E77UCI'
const COOP = 'GBPDUSWCRGZZUPY5EHZRXJXVQTBM3DDLKNTCZK5BJOPH5AN4DRZF5AHJ'

// ---------- fake Stellar RPC ----------
// `mode` decides how the network behaves for the scenario being run.
let mode = { kind: 'up' }
const resultXdr = (name) =>
  new xdr.TransactionResult({ feeCharged: 100n, result: xdr.TransactionResultResult[name](), ext: xdr.TransactionResultExt.v0() }).toXDR('base64')

const fakeRpc = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    if (mode.kind === 'down') return req.socket.destroy()
    const { id, method } = JSON.parse(body || '{}')
    const reply = (result) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result }))
    }
    switch (method) {
      case 'getHealth':
        return reply({ status: 'healthy', latestLedger: 100, oldestLedger: 1, ledgerRetentionWindow: 99 })
      case 'getLedgerEntries':
        return reply({ entries: [], latestLedger: 100 }) // every account is "missing"
      case 'sendTransaction': {
        const base = { hash: 'f'.repeat(64), latestLedger: 100, latestLedgerCloseTime: '1' }
        if (mode.kind === 'send-error') return reply({ ...base, status: 'ERROR', ...(mode.code && { errorResultXdr: resultXdr(mode.code) }) })
        if (mode.kind === 'try-again') return reply({ ...base, status: 'TRY_AGAIN_LATER' })
        return reply({ ...base, status: 'PENDING' })
      }
      default: // getTransaction and anything else: the connection drops
        return req.socket.destroy()
    }
  })
})

// ---------- helpers ----------
const freePort = () =>
  new Promise((resolve) => {
    const server = createNetServer().listen(0, () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })

const signer = Keypair.random()
const escrowTx = () => {
  const tx = new TransactionBuilder(new Account(signer.publicKey(), '1'), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(ESCROW).call('get_order', nativeToScVal(1n, { type: 'u64' })))
    .setTimeout(60)
    .build()
  tx.sign(signer)
  return tx.toXDR()
}
const newOrder = {
  buyer: BUYER, farmer: FARMER, arbiter: COOP, amount: '100',
  deliveryDeadline: new Date(Date.now() + 7 * 864e5).toISOString(), reviewWindowHours: 72,
}

// ---------- run ----------
await new Promise((resolve) => fakeRpc.listen(0, '127.0.0.1', resolve))
const rpcUrl = `http://127.0.0.1:${fakeRpc.address().port}`
const port = await freePort()
const backend = spawn('node', ['dist/index.js'], {
  env: { ...process.env, PORT: String(port), ESCROW_CONTRACT_ID: ESCROW, STELLAR_RPC_URL: rpcUrl, LOG_REQUESTS: 'false' },
  stdio: 'ignore',
})
const stop = () => { backend.kill('SIGKILL'); fakeRpc.close() }
process.on('exit', stop)

for (let i = 0; i < 50; i++) {
  if (await fetch(`http://localhost:${port}/api/health`).then((r) => r.ok, () => false)) break
  await new Promise((r) => setTimeout(r, 200))
}

async function call(method, path, body) {
  const res = await fetch(`http://localhost:${port}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, code: json.error?.code ?? 'none', message: json.error?.message ?? '' }
}

const scenarios = [
  // The Stellar RPC is unreachable
  ['RPC down: read an order', { kind: 'down' }, () => call('GET', '/orders/1'), 503, 'RPC_UNAVAILABLE'],
  ['RPC down: take an action', { kind: 'down' }, () => call('POST', '/orders/1/accept', {}), 503, 'RPC_UNAVAILABLE'],
  ['RPC down: create an order (must NOT say the account is missing)', { kind: 'down' }, () => call('POST', '/orders', newOrder), 503, 'RPC_UNAVAILABLE'],
  ['RPC down: submit a transaction', { kind: 'down' }, () => call('POST', '/transactions', { signedXdr: escrowTx() }), 503, 'RPC_UNAVAILABLE'],
  // The RPC is fine and the account really does not exist
  ['RPC up, account really missing', { kind: 'up' }, () => call('POST', '/orders', newOrder), 404, 'ACCOUNT_NOT_FOUND'],
  // The network refuses a submitted transaction
  ['network says: expired', { kind: 'send-error', code: 'txTooLate' }, () => call('POST', '/transactions', { signedXdr: escrowTx() }), 409, 'TRANSACTION_EXPIRED'],
  ['network says: stale sequence', { kind: 'send-error', code: 'txBadSeq' }, () => call('POST', '/transactions', { signedXdr: escrowTx() }), 409, 'TRANSACTION_STALE'],
  ['network says: bad signature', { kind: 'send-error', code: 'txBadAuth' }, () => call('POST', '/transactions', { signedXdr: escrowTx() }), 400, 'BAD_SIGNATURE'],
  ['network says: not enough XLM', { kind: 'send-error', code: 'txInsufficientBalance' }, () => call('POST', '/transactions', { signedXdr: escrowTx() }), 409, 'INSUFFICIENT_FUNDS'],
  ['network says: try again later', { kind: 'try-again' }, () => call('POST', '/transactions', { signedXdr: escrowTx() }), 503, 'NETWORK_BUSY'],
  ['network refuses with an unknown reason', { kind: 'send-error' }, () => call('POST', '/transactions', { signedXdr: escrowTx() }), 502, 'SUBMIT_FAILED'],
  // Connection lost after the transaction was sent: the user must not blindly retry
  ['connection lost after sending', { kind: 'sent-then-lost' }, () => call('POST', '/transactions', { signedXdr: escrowTx() }), 502, 'SUBMIT_UNCERTAIN'],
]

let failed = 0
for (const [name, nextMode, run, status, code] of scenarios) {
  mode = nextMode
  const started = Date.now()
  const got = await run()
  const ok = got.status === status && got.code === code
  if (!ok) failed++
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${String(got.status).padEnd(4)} ${got.code.padEnd(22)} ${name} (${secs}s)${ok ? '' : `\n        expected ${status} ${code}; message: ${got.message}`}`)
}

console.log(`\n${scenarios.length - failed}/${scenarios.length} checks passed`)
stop()
process.exit(failed ? 1 : 0)
