#!/usr/bin/env node
// Verifies the rule that makes POST /api/transactions safe: it only relays a single call to
// the configured escrow contract. Builds structurally valid transactions of every dangerous
// shape and fails if any of them is not rejected with 400 INVALID_TRANSACTION.
//
//   cd backend && npm run build && ESCROW_CONTRACT_ID=<id> node dist/index.js    # one terminal
//   ESCROW_CONTRACT_ID=<id> node scripts/check-relay-rules.mjs [host:port]        # another
//
// Every case is rejected before any call to the Stellar network, so this works offline.
// Add --online to also send two legitimate escrow calls and confirm they are NOT rejected by
// the relay (they then reach the network and fail there, because the test account is unfunded).

import {
  Account, Address, Asset, BASE_FEE, Contract, Keypair, Networks, Operation, TransactionBuilder, nativeToScVal,
} from '@stellar/stellar-sdk'

const args = process.argv.slice(2)
const online = args.includes('--online')
const host = args.find((a) => !a.startsWith('--')) ?? 'localhost:4000'
const escrow = process.env.ESCROW_CONTRACT_ID
if (!escrow) {
  console.error('Set ESCROW_CONTRACT_ID to the contract the backend is configured with.')
  process.exit(2)
}
const OTHER_CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'

const key = Keypair.random()
const draft = () => new TransactionBuilder(new Account(key.publicKey(), '1'), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
const callOn = (id) => new Contract(id).call('get_order', nativeToScVal(1n, { type: 'u64' }))
const pay = () => Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' })
const signed = (tx) => (tx.sign(key), tx)
const one = (...ops) => signed(ops.reduce((b, op) => b.addOperation(op), draft()).setTimeout(60).build())
const feeBump = (inner) => signed(TransactionBuilder.buildFeeBumpTransaction(key, '1000', inner, Networks.TESTNET))

const rejected = [
  ['payment', () => one(pay())],
  ['account merge', () => one(Operation.accountMerge({ destination: Keypair.random().publicKey() }))],
  ['escrow call plus a payment', () => one(callOn(escrow), pay())],
  ['two escrow calls', () => one(callOn(escrow), callOn(escrow))],
  ['call to a different contract', () => one(callOn(OTHER_CONTRACT))],
  ['upload contract code', () => one(Operation.uploadContractWasm({ wasm: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]) }))],
  ['create a contract', () => one(Operation.createCustomContract({ address: new Address(key.publicKey()), wasmHash: Buffer.alloc(32), salt: Buffer.alloc(32) }))],
  ['restore footprint', () => one(Operation.restoreFootprint({}))],
  ['fee bump wrapping a payment', () => feeBump(one(pay()))],
  ['fee bump wrapping two operations', () => feeBump(one(callOn(escrow), pay()))],
]
const allowed = [
  ['single escrow call', () => one(callOn(escrow))],
  ['fee bump wrapping a single escrow call', () => feeBump(one(callOn(escrow)))],
]

async function submit(tx) {
  const res = await fetch(`http://${host}/api/transactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signedXdr: tx.toXDR() }),
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, code: body.error?.code ?? 'none' }
}

let failed = 0
let total = 0
const report = (ok, line) => {
  total++
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${line}`)
}

console.log('Must be rejected by the relay')
for (const [name, build] of rejected) {
  const { status, code } = await submit(build())
  report(status === 400 && code === 'INVALID_TRANSACTION', `${String(status).padEnd(4)} ${code.padEnd(20)} ${name}`)
}
if (online) {
  console.log('Must NOT be rejected by the relay (the network refuses them: unfunded test account)')
  for (const [name, build] of allowed) {
    const { status, code } = await submit(build())
    report(code !== 'INVALID_TRANSACTION', `${String(status).padEnd(4)} ${code.padEnd(20)} ${name}`)
  }
}

console.log(`\n${total - failed}/${total} checks passed`)
process.exit(failed ? 1 : 0)
