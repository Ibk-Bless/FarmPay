import dotenv from 'dotenv'
import { Networks } from '@stellar/stellar-sdk'

dotenv.config()

export const config = {
  port: Number(process.env.PORT ?? 4000),
  rpcUrl: process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET,
  escrowContractId: process.env.ESCROW_CONTRACT_ID ?? '',
  // Comma-separated browser origins allowed to call the API. Unset allows any origin (development).
  corsOrigins: (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  logRequests: process.env.LOG_REQUESTS !== 'false',
  // Per client address, on the order and transaction routes. 0 turns the limit off.
  rateLimitMax: nonNegative(process.env.RATE_LIMIT_MAX, 60),
  rateLimitWindowSeconds: Math.max(1, nonNegative(process.env.RATE_LIMIT_WINDOW_SECONDS, 60)),
  // Reverse proxies in front of the API (0 if clients connect directly).
  trustProxy: nonNegative(process.env.TRUST_PROXY, 0),
  // The order index: a rebuildable local copy of every order (see src/indexer/).
  indexDbPath: process.env.INDEX_DB_PATH ?? './data/index.sqlite',
  indexPollMs: Math.max(1000, Number(process.env.INDEX_POLL_MS ?? 5000) || 5000),
  indexStartLedger: process.env.INDEX_START_LEDGER ? Number(process.env.INDEX_START_LEDGER) : undefined,
}

function nonNegative(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return value !== undefined && value.trim() !== '' && Number.isInteger(n) && n >= 0 ? n : fallback
}
