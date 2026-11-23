// Unit tests for the pure helpers in src/stellar/escrow.ts: amounts, contract error mapping and
// order decoding. They also read the contract's source, so the mapping cannot drift from it.
//
//   cd backend && npm test

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { EscrowError, contractError, formatUsdc, isNetworkFailure, parseUsdc, toOrder } from '../dist/stellar/escrow.js'

const invalid = (value) => () => parseUsdc(value)
const isInvalidAmount = (err) => err instanceof EscrowError && err.code === 'INVALID_AMOUNT' && err.status === 400

describe('parseUsdc', () => {
  const valid = [
    ['0', 0n],
    ['1', 10_000_000n],
    ['100', 1_000_000_000n],
    ['0.0000001', 1n], // the smallest unit
    ['1.5', 15_000_000n],
    ['1.50', 15_000_000n],
    ['1840.5', 18_405_000_000n],
    ['0.1234567', 1_234_567n], // exactly 7 decimals
    ['007', 70_000_000n], // leading zeros are harmless
    ['17014118346046923173168730371588.4105727', 2n ** 127n - 1n], // the largest value an i128 holds
  ]
  for (const [text, units] of valid) {
    it(`reads "${text}" as ${units} units`, () => assert.equal(parseUsdc(text), units))
  }

  const rejected = [
    ['an empty string', ''],
    ['whitespace', '  '],
    ['a negative amount', '-1'],
    ['a negative zero', '-0'],
    ['a plus sign', '+1'],
    ['8 decimals', '1.12345678'],
    ['a trailing dot', '1.'],
    ['a leading dot', '.5'],
    ['a comma', '1,5'],
    ['scientific notation', '1e5'],
    ['hex', '0x10'],
    ['letters', 'abc'],
    ['surrounding spaces', ' 1 '],
    ['a newline', '1\n'],
    ['more than an i128 holds', '17014118346046923173168730371588.4105728'],
    ['41 digits', '9'.repeat(41)],
  ]
  for (const [name, text] of rejected) {
    it(`rejects ${name}`, () => assert.throws(invalid(text), isInvalidAmount))
  }

  it('never echoes more than 40 characters of a bad value into the error', () => {
    assert.throws(invalid('x'.repeat(500)), (err) => err.message.length < 120)
  })
})

describe('formatUsdc', () => {
  const cases = [
    [0n, '0'],
    [1n, '0.0000001'],
    [10_000_000n, '1'],
    [15_000_000n, '1.5'], // trailing zeros are trimmed
    [18_405_000_000n, '1840.5'],
    [12_345_678n, '1.2345678'],
    [100_000_000_000_000n, '10000000'],
    [2n ** 127n - 1n, '17014118346046923173168730371588.4105727'],
  ]
  for (const [units, text] of cases) {
    it(`writes ${units} units as "${text}"`, () => assert.equal(formatUsdc(units), text))
  }

  it('is the inverse of parseUsdc', () => {
    for (const units of [0n, 1n, 9_999_999n, 10_000_001n, 123_456_789_012_345n, 2n ** 127n - 1n]) {
      assert.equal(parseUsdc(formatUsdc(units)), units)
    }
  })
})

describe('contract error mapping', () => {
  const contract = (n) => `HostError: Error(Contract, #${n})\n  Event log (newest first): ...`

  // Written out by hand, so a change to the mapping has to be a deliberate change here too.
  const expected = {
    1: ['ORDER_NOT_FOUND', 404],
    2: ['INVALID_AMOUNT', 400],
    3: ['INVALID_PARTIES', 400],
    4: ['INVALID_DEADLINE', 400],
    5: ['INVALID_STATUS', 409],
    6: ['TOO_EARLY', 409],
    7: ['TOO_LATE', 409],
    8: ['INVALID_SPLIT', 400],
  }
  for (const [number, [code, status]] of Object.entries(expected)) {
    it(`contract error #${number} is ${status} ${code}`, () => {
      const err = contractError(contract(number))
      assert.ok(err instanceof EscrowError)
      assert.equal(err.code, code)
      assert.equal(err.status, status)
    })
  }

  it('covers every error the contract defines, under its own name', () => {
    const source = readFileSync(new URL('../../contracts/escrow/src/lib.rs', import.meta.url), 'utf8')
    const block = /pub enum Error \{([^}]*)\}/.exec(source)[1]
    const variants = [...block.matchAll(/(\w+)\s*=\s*(\d+)/g)].map(([, name, number]) => [name, Number(number)])
    assert.ok(variants.length >= 8)
    for (const [name, number] of variants) {
      const snake = name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()
      assert.equal(contractError(contract(number)).code, snake, `contract error #${number} (${name}) is not mapped`)
    }
    assert.equal(variants.length, Object.keys(expected).length, 'the contract gained or lost an error: update this test')
  })

  it('an authorization failure is a 403 UNAUTHORIZED', () => {
    const err = contractError('HostError: Error(Auth, InvalidAction)')
    assert.deepEqual([err.code, err.status], ['UNAUTHORIZED', 403])
  })

  it('anything else is a 502 SIMULATION_FAILED that keeps the original message', () => {
    for (const message of ['HostError: Error(Contract, #99)', 'HostError: Error(WasmVm, InvalidAction)', 'boom', '']) {
      const err = contractError(message)
      assert.deepEqual([err.code, err.status, err.message], ['SIMULATION_FAILED', 502, message])
    }
  })
})

describe('toOrder', () => {
  const raw = (overrides = {}) => ({
    id: 7n,
    buyer: 'GB',
    farmer: 'GF',
    arbiter: 'GA',
    amount: 18_405_000_000n,
    delivery_deadline: 1_900_000_000n,
    review_window: 259_200n,
    review_deadline: 0n,
    dispute_window: 604_800n,
    dispute_deadline: 0n,
    status: ['Funded'],
    ...overrides,
  })

  it('turns the contract record into the API shape', () => {
    assert.deepEqual(toOrder(raw()), {
      id: '7',
      buyer: 'GB',
      farmer: 'GF',
      arbiter: 'GA',
      amount: '1840.5',
      deliveryDeadline: 1_900_000_000,
      reviewWindow: 259_200,
      reviewDeadline: 0,
      disputeWindow: 604_800,
      disputeDeadline: 0,
      status: 'Funded',
    })
  })

  it('reads a status given as a one-element array or as a plain string', () => {
    assert.equal(toOrder(raw({ status: ['Disputed'] })).status, 'Disputed')
    assert.equal(toOrder(raw({ status: 'Resolved' })).status, 'Resolved')
  })
})

describe('isNetworkFailure', () => {
  it('is true for connection failures and 5xx answers', () => {
    assert.ok(isNetworkFailure({ name: 'AxiosError' })) // no response at all
    assert.ok(isNetworkFailure({ name: 'AxiosError', response: { status: 503 } }))
    assert.ok(isNetworkFailure(new Error('fetch failed')))
    assert.ok(isNetworkFailure(new Error('connect ECONNREFUSED 127.0.0.1:1')))
  })
  it('is false when the RPC answered that the request was wrong', () => {
    assert.ok(!isNetworkFailure({ name: 'AxiosError', response: { status: 400 } }))
    assert.ok(!isNetworkFailure(new Error('Error(Contract, #5)')))
    assert.ok(!isNetworkFailure(null))
  })
})
