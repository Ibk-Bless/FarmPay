#!/usr/bin/env node
// Checks the request limit: that a client over it gets a clear 429, that other clients and the
// health check are unaffected, that the window resets, and that the client address is read from
// X-Forwarded-For only when a proxy is configured.
//
//   cd backend && npm run build && node scripts/check-rate-limit.mjs
//
// Needs no network access. The orders router is never reached: a request for order "x" is
// rejected as invalid before the contract is contacted.

import { createApp } from '../dist/app.js'

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`)
  if (!ok) failed++
}

async function serve(options) {
  const app = createApp({ escrow: {}, logRequests: false, ...options })
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = `http://127.0.0.1:${server.address().port}/api`
  const get = async (path, headers = {}) => {
    const res = await fetch(base + path, { headers })
    return { res, body: await res.json().catch(() => null) }
  }
  return { get, close: () => new Promise((resolve) => server.close(resolve)) }
}

// ---- a limit of 3 per second ----
{
  const s = await serve({ rateLimit: { max: 3, windowMs: 1000 } })
  const codes = []
  for (let i = 0; i < 5; i++) codes.push((await s.get('/orders/x')).res.status)
  check('the first 3 requests are answered normally', codes.slice(0, 3).every((c) => c !== 429), JSON.stringify(codes))
  check('the 4th and 5th are refused with 429', codes[3] === 429 && codes[4] === 429, JSON.stringify(codes))

  const limited = await s.get('/orders/x')
  check('429 uses the standard error format', limited.body?.error?.code === 'RATE_LIMITED' && typeof limited.body.error.message === 'string', JSON.stringify(limited.body))
  check('429 says when to retry', Number(limited.res.headers.get('retry-after')) >= 1, limited.res.headers.get('retry-after'))
  check('429 carries the request id', Boolean(limited.res.headers.get('x-request-id')))
  check('limit headers are sent', limited.res.headers.get('ratelimit-limit') === '3' && limited.res.headers.get('ratelimit-remaining') === '0')

  check('the health check is never limited', (await Promise.all([1, 2, 3, 4, 5].map(() => s.get('/health')))).every((r) => r.res.status === 200))
  check('unknown paths are limited too (they cost nothing but must not bypass it)', (await s.get('/nope')).res.status === 429)

  await new Promise((resolve) => setTimeout(resolve, 1100))
  check('the window resets', (await s.get('/orders/x')).res.status !== 429)
  await s.close()
}

// ---- no proxy configured: X-Forwarded-For is ignored, so it cannot be used to dodge the limit ----
{
  const s = await serve({ rateLimit: { max: 2, windowMs: 60_000 } })
  const codes = []
  for (let i = 0; i < 4; i++) codes.push((await s.get('/orders/x', { 'x-forwarded-for': `10.0.0.${i}` })).res.status)
  check('a spoofed X-Forwarded-For does not reset the limit', codes[2] === 429 && codes[3] === 429, JSON.stringify(codes))
  await s.close()
}

// ---- one proxy configured: each forwarded address has its own allowance ----
{
  const s = await serve({ rateLimit: { max: 1, windowMs: 60_000 }, trustProxy: 1 })
  const a1 = (await s.get('/orders/x', { 'x-forwarded-for': '10.0.0.1' })).res.status
  const a2 = (await s.get('/orders/x', { 'x-forwarded-for': '10.0.0.1' })).res.status
  const b1 = (await s.get('/orders/x', { 'x-forwarded-for': '10.0.0.2' })).res.status
  check('behind a proxy, clients are told apart', a1 !== 429 && a2 === 429 && b1 !== 429, JSON.stringify([a1, a2, b1]))
  await s.close()
}

// ---- off ----
for (const rateLimit of [undefined, { max: 0, windowMs: 1000 }]) {
  const s = await serve({ rateLimit })
  const codes = []
  for (let i = 0; i < 30; i++) codes.push((await s.get('/orders/x')).res.status)
  check(`no limit when ${rateLimit ? 'max is 0' : 'unset'}`, !codes.includes(429))
  await s.close()
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall rate-limit checks passed')
process.exit(failed ? 1 : 0)
