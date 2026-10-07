import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import { EscrowService } from './stellar/escrow.js'
import { errorHandler, ordersRouter } from './routes/orders.js'

const app = express()

app.use(cors())
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', escrowContractId: config.escrowContractId || null })
})

if (config.escrowContractId) {
  const escrow = new EscrowService(config.rpcUrl, config.networkPassphrase, config.escrowContractId)
  app.use('/api', ordersRouter(escrow))
} else {
  console.warn('ESCROW_CONTRACT_ID is not set; order endpoints are disabled. See docs/GETTING_STARTED.md.')
}

app.use(errorHandler)

app.listen(config.port, () => {
  console.log(`🌾 FarmPay API listening on port ${config.port}`)
  console.log(`Stellar RPC: ${config.rpcUrl}`)
})
