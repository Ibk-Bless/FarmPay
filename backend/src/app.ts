import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import { EscrowError, type EscrowService } from './stellar/escrow.js'
import { ordersRouter } from './routes/orders.js'

export interface AppOptions {
  /** Omit to run without order endpoints (e.g. the contract is not deployed yet). */
  escrow?: EscrowService
  escrowContractId?: string
}

/** Builds the Express app without listening, so it can be tested or embedded. */
export function createApp({ escrow, escrowContractId }: AppOptions = {}): Express {
  const app = express()

  app.use(cors())
  app.use(express.json({ limit: '100kb' }))

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', escrowContractId: escrowContractId || null })
  })

  if (escrow) app.use('/api', ordersRouter(escrow))

  // Unknown API paths get the same JSON error format as everything else.
  app.use('/api', (req, _res, next) => {
    next(new EscrowError('NOT_FOUND', `No route for ${req.method} ${req.originalUrl}`, 404))
  })

  app.use(errorHandler)
  return app
}

interface HttpError extends Error {
  status?: number
  type?: string
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof EscrowError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } })
    return
  }

  // Malformed or oversized request bodies are client errors, not server errors.
  const http = err as HttpError
  if (http.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } })
    return
  }
  if (http.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } })
    return
  }

  console.error(err)
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } })
}
