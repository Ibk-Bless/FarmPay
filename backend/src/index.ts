import { createApp } from './app.js'
import { config } from './config.js'
import { Indexer } from './indexer/indexer.js'
import { OrderIndex } from './indexer/orderIndex.js'
import { EscrowService } from './stellar/escrow.js'

const escrow = config.escrowContractId
  ? new EscrowService(config.rpcUrl, config.networkPassphrase, config.escrowContractId)
  : undefined

if (!escrow) {
  console.warn('ESCROW_CONTRACT_ID is not set; order endpoints are disabled. See docs/GETTING_STARTED.md.')
}

// Keeps a local copy of every order so the API can list an account's orders. It is a cache:
// delete the database and it is rebuilt from the chain.
const indexer = escrow
  ? new Indexer(escrow, new OrderIndex(config.indexDbPath), {
      pollMs: config.indexPollMs,
      startLedger: config.indexStartLedger,
      log: (message) => console.log(JSON.stringify({ time: new Date().toISOString(), indexer: message })),
    })
  : undefined

const app = createApp({
  escrow,
  escrowContractId: config.escrowContractId,
  indexer,
  corsOrigins: config.corsOrigins,
  logRequests: config.logRequests,
})

if (config.corsOrigins.length === 0) {
  console.warn('CORS_ORIGIN is not set; any website can call this API. Set it before deploying.')
}

const server = app.listen(config.port, () => {
  console.log(`🌾 FarmPay API listening on port ${config.port}`)
  console.log(`Stellar RPC: ${config.rpcUrl}`)
  indexer?.start()
})

// Finish in-flight requests (a transaction may be mid-submit) before exiting, then stop the
// indexer so its database is closed cleanly.
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`)
  setTimeout(() => process.exit(1), 10_000).unref()
  server.close(async () => {
    await indexer?.stop()
    indexer?.index.close()
    process.exit(0)
  })
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
