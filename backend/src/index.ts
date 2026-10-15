import { createApp } from './app.js'
import { config } from './config.js'
import { EscrowService } from './stellar/escrow.js'

const escrow = config.escrowContractId
  ? new EscrowService(config.rpcUrl, config.networkPassphrase, config.escrowContractId)
  : undefined

if (!escrow) {
  console.warn('ESCROW_CONTRACT_ID is not set; order endpoints are disabled. See docs/GETTING_STARTED.md.')
}

const app = createApp({ escrow, escrowContractId: config.escrowContractId })

const server = app.listen(config.port, () => {
  console.log(`🌾 FarmPay API listening on port ${config.port}`)
  console.log(`Stellar RPC: ${config.rpcUrl}`)
})

// Finish in-flight requests (a transaction may be mid-submit) before exiting.
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
