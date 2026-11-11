import { randomUUID } from 'node:crypto'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import { EscrowError, type EscrowService } from './stellar/escrow.js'
import { ordersRouter } from './routes/orders.js'
import type { Indexer } from './indexer/indexer.js'
import { rateLimit } from './rateLimit.js'

export interface AppOptions {
  /** Omit to run without order endpoints (e.g. the contract is not deployed yet). */
  escrow?: EscrowService
  escrowContractId?: string
  /** Keeps the list of orders per account; without it `GET /api/orders` answers 503. */
  indexer?: Indexer
  /** Browser origins allowed to call the API. Empty or omitted allows any origin. */
  corsOrigins?: string[]
  /** One JSON log line per request. Defaults to on. */
  logRequests?: boolean
  /** Requests per client per window on the order and transaction routes. Omit or 0 for no limit. */
  rateLimit?: { max: number; windowMs: number }
  /** How many reverse proxies sit in front, so the client address is read from X-Forwarded-For. */
  trustProxy?: number
}

/** Builds the Express app without listening, so it can be tested or embedded. */
export function createApp({
  escrow,
  escrowContractId,
  indexer,
  corsOrigins = [],
  logRequests = true,
  rateLimit: limit,
  trustProxy = 0,
}: AppOptions = {}): Express {
  const app = express()
  app.set('trust proxy', trustProxy)

  app.use(requestId(logRequests))
  app.use(
    cors({
      // `origin: true` reflects any caller, which is the open development default.
      origin: corsOrigins.length > 0 ? corsOrigins : true,
      exposedHeaders: ['X-Request-Id'],
    }),
  )
  app.use(express.json({ limit: '100kb' }))

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      escrowContractId: escrowContractId || null,
      index: indexer
        ? {
            synced: indexer.synced,
            indexedLedger: indexer.indexedLedger,
            orders: indexer.index.count(),
            ...(indexer.lastError && { lastError: indexer.lastError }),
          }
        : null,
    })
  })

  if (escrow) {
    // After /api/health, so monitoring is never limited.
    if (limit && limit.max > 0) app.use('/api', rateLimit(limit))
    app.use('/api', ordersRouter(escrow, indexer))
  }

  // Unknown API paths get the same JSON error format as everything else.
  app.use('/api', (req, _res, next) => {
    next(new EscrowError('NOT_FOUND', `No route for ${req.method} ${req.originalUrl}`, 404))
  })

  app.use(errorHandler)
  return app
}

/**
 * Tags every request with an id (also returned as `X-Request-Id`, so a user can quote it in a
 * bug report) and logs one JSON line when the response finishes. Bodies are never logged.
 */
function requestId(log: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = randomUUID()
    res.locals.requestId = id
    res.setHeader('X-Request-Id', id)

    // `req.path` is relative to the mounted router by the time the response finishes,
    // so take the full path from `originalUrl` (without the query string).
    const path = req.originalUrl.split('?')[0]
    if (log && path !== '/api/health') {
      const started = process.hrtime.bigint()
      res.on('finish', () => {
        console.log(
          JSON.stringify({
            time: new Date().toISOString(),
            requestId: id,
            method: req.method,
            path,
            status: res.statusCode,
            ms: Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10,
          }),
        )
      })
    }
    next()
  }
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

  console.error(JSON.stringify({ requestId: res.locals.requestId, error: String(err) }))
  console.error(err)
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } })
}
