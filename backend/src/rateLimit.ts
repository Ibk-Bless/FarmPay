import type { NextFunction, Request, Response } from 'express'
import { EscrowError } from './stellar/escrow.js'

export interface RateLimitOptions {
  /** Requests one client may make per window. */
  max: number
  windowMs: number
  /** Replaceable in tests. */
  now?: () => number
}

/**
 * A fixed-window limit per client address. Every build request costs an RPC simulation, so
 * without a limit one client can use up the RPC quota for everybody.
 *
 * It lives in memory, which is right for a single backend process. Behind several instances each
 * one counts separately, so the real limit is `max` times the number of instances.
 */
export function rateLimit({ max, windowMs, now = Date.now }: RateLimitOptions) {
  const clients = new Map<string, { count: number; resetAt: number }>()
  let lastSweep = now()

  return (req: Request, res: Response, next: NextFunction) => {
    const time = now()

    // Forget clients whose window has ended, so the map cannot grow without bound.
    if (time - lastSweep >= windowMs) {
      for (const [key, entry] of clients) if (entry.resetAt <= time) clients.delete(key)
      lastSweep = time
    }

    const key = req.ip ?? 'unknown'
    let entry = clients.get(key)
    if (!entry || entry.resetAt <= time) {
      entry = { count: 0, resetAt: time + windowMs }
      clients.set(key, entry)
    }
    entry.count++

    res.setHeader('RateLimit-Limit', String(max))
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)))
    res.setHeader('RateLimit-Reset', String(Math.ceil((entry.resetAt - time) / 1000)))

    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - time) / 1000))
      res.setHeader('Retry-After', String(retryAfter))
      next(new EscrowError('RATE_LIMITED', `Too many requests. Try again in ${retryAfter} seconds.`, 429))
      return
    }
    next()
  }
}
