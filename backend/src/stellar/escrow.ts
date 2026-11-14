// Client for the FarmPay Soroban escrow contract (see contracts/escrow/README.md).
// The backend never holds user keys: it builds unsigned transactions for the
// user's wallet to sign, then relays the signed transaction to the network.

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk'
import type { EventPage } from '../indexer/indexer.js'

export const USDC_DECIMALS = 7

export type OrderStatus =
  | 'Funded'
  | 'Accepted'
  | 'Delivered'
  | 'Disputed'
  | 'Released'
  | 'Refunded'
  | 'Resolved'

export interface Order {
  id: string
  buyer: string
  farmer: string
  arbiter: string
  amount: string
  deliveryDeadline: number
  reviewWindow: number
  reviewDeadline: number
  disputeWindow: number
  disputeDeadline: number
  status: OrderStatus
}

export interface CreateOrderParams {
  buyer: string
  farmer: string
  arbiter: string
  amount: bigint
  deliveryDeadline: number
  reviewWindow: number
  disputeWindow: number
}

// Mirrors the contract's `Error` enum.
const CONTRACT_ERRORS: Record<number, { code: string; status: number }> = {
  1: { code: 'ORDER_NOT_FOUND', status: 404 },
  2: { code: 'INVALID_AMOUNT', status: 400 },
  3: { code: 'INVALID_PARTIES', status: 400 },
  4: { code: 'INVALID_DEADLINE', status: 400 },
  5: { code: 'INVALID_STATUS', status: 409 },
  6: { code: 'TOO_EARLY', status: 409 },
  7: { code: 'TOO_LATE', status: 409 },
  8: { code: 'INVALID_SPLIT', status: 400 },
}

// What the network says when it refuses a transaction, in terms a user can act on.
// Keys are Stellar transaction result codes.
const SUBMIT_ERRORS: Record<string, { code: string; status: number; message: string }> = {
  txTooLate: {
    code: 'TRANSACTION_EXPIRED',
    status: 409,
    message: 'The transaction expired before it was submitted. Prepare it again and approve it within a few minutes.',
  },
  txBadSeq: {
    code: 'TRANSACTION_STALE',
    status: 409,
    message: 'Your account changed since this transaction was prepared. Another transaction may have gone through first, possibly this same one. Check the order, then try again if nothing changed.',
  },
  txBadAuth: {
    code: 'BAD_SIGNATURE',
    status: 400,
    message: 'The transaction was not signed by the right account. Check that your wallet is using the account for this order.',
  },
  txBadAuthExtra: {
    code: 'BAD_SIGNATURE',
    status: 400,
    message: 'The transaction carries a signature it does not need. Please prepare it again.',
  },
  txInsufficientBalance: {
    code: 'INSUFFICIENT_FUNDS',
    status: 409,
    message: 'Your account does not have enough XLM to pay the network fee and keep its minimum balance.',
  },
  txInsufficientFee: {
    code: 'FEE_TOO_LOW',
    status: 409,
    message: 'The network fee was too low because the network is busy. Please prepare the transaction again.',
  },
  txNoAccount: {
    code: 'ACCOUNT_NOT_FOUND',
    status: 404,
    message: 'The signing account does not exist on the network yet. Fund it with XLM first.',
  },
}

/**
 * True when the Stellar RPC could not be reached or failed on its side (as opposed to it
 * answering that something we asked for is wrong). Axios-style errors with no response are
 * connection failures; 5xx responses are an RPC outage.
 */
export function isNetworkFailure(err: unknown): boolean {
  const e = err as { name?: string; message?: string; response?: { status?: number } } | null
  if (e?.name === 'AxiosError') return !e.response || (e.response.status ?? 0) >= 500
  return /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(String(e?.message ?? ''))
}

const rpcTimeout = (ms: number) =>
  new EscrowError(
    'RPC_TIMEOUT',
    `The Stellar network did not answer within ${Math.round(ms / 1000)} seconds. Please try again in a moment.`,
    504,
  )

const rpcUnavailable = () =>
  new EscrowError('RPC_UNAVAILABLE', "Can't reach the Stellar network right now. Please try again in a moment.", 503)

/** An RPC call that did not answer in time. Turned into a 504 (or `SUBMIT_UNCERTAIN`) by the caller. */
class RpcTimeout extends Error {}

export interface EscrowOptions {
  /** How long to wait for one RPC call. */
  timeoutMs?: number
  /** Pause before the single retry of a read. */
  retryDelayMs?: number
}

export class EscrowError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message)
  }
}

export class EscrowService {
  private server: rpc.Server
  private contract: Contract
  /** The escrow's token, read once: a deployed contract never changes it. */
  private tokenId: string | undefined
  private timeoutMs: number
  private retryDelayMs: number

  constructor(
    rpcUrl: string,
    private networkPassphrase: string,
    private contractId: string,
    options: EscrowOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.retryDelayMs = options.retryDelayMs ?? 300
    this.server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') })
    this.contract = new Contract(contractId)
  }

  /** The newest ledger, and the oldest one the RPC still keeps events for. */
  async ledgerRange(): Promise<{ latest: number; oldest: number }> {
    const health = await this.rpc(() => this.server.getHealth())
    return { latest: health.latestLedger, oldest: health.oldestLedger }
  }

  /**
   * One page of events saying orders changed. The RPC scans only a slice of ledgers per call
   * and hands back a cursor to continue from, so an empty page does not mean "no more": keep
   * going until `caughtUp`. Only the order ids are read; the order is then fetched afresh.
   */
  async orderEvents(from: { ledger: number } | { cursor: string }, limit = 200): Promise<EventPage> {
    const filters = [{ type: 'contract' as const, contractIds: [this.contractId] }]
    const request = 'cursor' in from ? { filters, cursor: from.cursor, limit } : { filters, startLedger: from.ledger, limit }
    const res = await this.rpc(() => this.server.getEvents(request))

    const orderIds = new Set<bigint>()
    for (const event of res.events) {
      // The real RPC omits this field; only an explicit `false` marks a failed call.
      if (event.inSuccessfulContractCall === false) continue
      const [name, id] = event.topic.map((topic) => scValToNative(topic))
      if (name === 'status_changed' && typeof id === 'bigint') orderIds.add(id)
    }

    // The cursor is a transaction id whose upper bits are the ledger sequence.
    const cursorLedger = Number(BigInt(res.cursor.split('-')[0]) >> 32n)
    return {
      orderIds: [...orderIds],
      cursor: res.cursor,
      latestLedger: res.latestLedger,
      caughtUp: res.events.length < limit && cursorLedger >= res.latestLedger - 1,
    }
  }

  /** Unsigned `create_order` transaction, to be signed by the buyer. */
  buildCreateOrder(p: CreateOrderParams): Promise<string> {
    return this.buildCall(p.buyer, 'create_order', [
      address(p.buyer),
      address(p.farmer),
      address(p.arbiter),
      nativeToScVal(p.amount, { type: 'i128' }),
      nativeToScVal(p.deliveryDeadline, { type: 'u64' }),
      nativeToScVal(p.reviewWindow, { type: 'u64' }),
      nativeToScVal(p.disputeWindow, { type: 'u64' }),
    ])
  }

  /** Unsigned transaction for any order action that takes the order id first. */
  buildOrderCall(
    signer: string,
    method: string,
    orderId: bigint,
    extraArgs: xdr.ScVal[] = [],
  ): Promise<string> {
    return this.buildCall(signer, method, [nativeToScVal(orderId, { type: 'u64' }), ...extraArgs])
  }

  async getOrder(orderId: bigint): Promise<Order> {
    // Read-only call: simulate with a throwaway source account, never submitted.
    const source = new Account(Keypair.random().publicKey(), '0')
    const tx = this.transaction(source, 'get_order', [nativeToScVal(orderId, { type: 'u64' })])
    const sim = await this.rpc(() => this.server.simulateTransaction(tx))
    if (rpc.Api.isSimulationError(sim)) throw contractError(sim.error)
    if (!sim.result) throw new EscrowError('SIMULATION_FAILED', 'Contract returned no result', 502)
    return toOrder(scValToNative(sim.result.retval))
  }

  /**
   * How much of the escrow's token `account` holds, as a decimal string ("0" without a
   * trustline). Lets the app warn about too little USDC before a transaction is attempted.
   */
  async getBalance(account: string): Promise<string> {
    this.tokenId ??= addressOf(await this.read(this.contract, 'token', []))
    const raw = await this.read(new Contract(this.tokenId), 'balance', [address(account)])
    return formatUsdc(BigInt(raw as bigint))
  }

  /** Simulates a read-only call with a throwaway source account; nothing is submitted. */
  private async read(contract: Contract, method: string, args: xdr.ScVal[]): Promise<unknown> {
    const source = new Account(Keypair.random().publicKey(), '0')
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: this.networkPassphrase })
      .addOperation(contract.call(method, ...args))
      .setTimeout(300)
      .build()
    const sim = await this.rpc(() => this.server.simulateTransaction(tx))
    if (rpc.Api.isSimulationError(sim)) throw contractError(sim.error)
    if (!sim.result) throw new EscrowError('SIMULATION_FAILED', 'Contract returned no result', 502)
    return scValToNative(sim.result.retval)
  }

  /** Submit a transaction signed by the user and wait for the result. */
  async submit(signedXdr: string): Promise<{ hash: string; returnValue: unknown }> {
    let tx
    try {
      tx = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase)
    } catch {
      throw new EscrowError('INVALID_TRANSACTION', 'signedXdr is not a valid transaction')
    }
    if (!this.isEscrowCall(tx.operations)) {
      throw new EscrowError('INVALID_TRANSACTION', 'Transaction must be a single FarmPay escrow call')
    }

    // Never retried. If it times out the network may still have accepted it, so say so, with the
    // hash to look up, instead of letting the user submit again blindly.
    let sent
    try {
      sent = await this.rpc(() => this.server.sendTransaction(tx), { retry: false })
    } catch (err) {
      if (err instanceof EscrowError && err.code === 'RPC_TIMEOUT') {
        throw new EscrowError(
          'SUBMIT_UNCERTAIN',
          `Your transaction was sent, but the network did not confirm it in time. Check the order before trying again. Transaction: ${Buffer.from(tx.hash()).toString('hex')}`,
          502,
        )
      }
      throw err
    }
    if (sent.status === 'TRY_AGAIN_LATER') {
      throw new EscrowError(
        'NETWORK_BUSY',
        'The network is busy, or already has this transaction. Check the order, then try again if nothing changed.',
        503,
      )
    }
    if (sent.status === 'ERROR') {
      const reason = SUBMIT_ERRORS[sent.errorResult?.result.type ?? '']
      if (reason) throw new EscrowError(reason.code, reason.message, reason.status)
      throw new EscrowError('SUBMIT_FAILED', `The network rejected the transaction (${sent.errorResult?.result.type ?? 'unknown reason'})`, 502)
    }

    let result
    try {
      result = await this.server.pollTransaction(sent.hash, { attempts: 30 })
    } catch (err) {
      // The transaction was accepted for processing, so it may still succeed. Never tell the
      // user to simply retry: a second submission could duplicate the action.
      if (!isNetworkFailure(err)) throw err
      throw new EscrowError(
        'SUBMIT_UNCERTAIN',
        `Your transaction was sent, but we lost contact with the network before it was confirmed. Check the order before trying again. Transaction: ${sent.hash}`,
        502,
      )
    }
    if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new EscrowError('TRANSACTION_FAILED', `Transaction ${sent.hash} ended as ${result.status}`, 502)
    }
    return {
      hash: sent.hash,
      returnValue: result.returnValue ? scValToNative(result.returnValue) : undefined,
    }
  }

  private async buildCall(signer: string, method: string, args: xdr.ScVal[]): Promise<string> {
    let source
    try {
      source = await this.rpc(() => this.server.getAccount(signer))
    } catch (err) {
      if (err instanceof EscrowError) throw err // already a clear network error
      // The SDK reports every failure here as "account not found", including an unreachable RPC.
      // Check which it really is, so a network blip doesn't tell a funded user their account is gone.
      if (await this.isUnreachable()) throw rpcUnavailable()
      throw new EscrowError('ACCOUNT_NOT_FOUND', `Account ${signer} does not exist on the network`, 404)
    }
    try {
      const prepared = await this.rpc(() => this.server.prepareTransaction(this.transaction(source, method, args)))
      return prepared.toXDR()
    } catch (err) {
      if (err instanceof EscrowError) throw err
      throw contractError(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * Runs an RPC call with a time limit. Connection failures become a clear 503 and timeouts a 504.
   * Reads are tried once more after a short pause, since the failures seen on testnet are brief.
   * Pass `retry: false` for anything that changes state, so it can never run twice.
   */
  private async rpc<T>(call: () => Promise<T>, { retry = true }: { retry?: boolean } = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.withTimeout(call)
      } catch (err) {
        const timedOut = err instanceof RpcTimeout
        if ((timedOut || isNetworkFailure(err)) && retry && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs))
          continue
        }
        if (timedOut) throw rpcTimeout(this.timeoutMs)
        if (isNetworkFailure(err)) throw rpcUnavailable()
        throw err
      }
    }
  }

  private withTimeout<T>(call: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new RpcTimeout()), this.timeoutMs)
      call().then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (err: unknown) => {
          clearTimeout(timer)
          reject(err)
        },
      )
    })
  }

  private async isUnreachable(): Promise<boolean> {
    try {
      await this.server.getHealth()
      return false
    } catch {
      return true
    }
  }

  private transaction(source: Account, method: string, args: xdr.ScVal[]) {
    return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: this.networkPassphrase })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(300)
      .build()
  }

  private isEscrowCall(operations: Transaction['operations']): boolean {
    const [op] = operations
    if (operations.length !== 1 || op.type !== 'invokeHostFunction') return false
    const fn = op.func
    if (fn.type !== 'hostFunctionTypeInvokeContract') return false
    return Address.fromScAddress(fn.invokeContract.contractAddress).toString() === this.contractId
  }
}

/** The contract stores amounts as i128, so nothing above this can be encoded. */
const MAX_AMOUNT = 2n ** 127n - 1n

export function parseUsdc(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(value)
  if (!match) throw new EscrowError('INVALID_AMOUNT', `"${value.slice(0, 40)}" is not a valid USDC amount`)
  const [, whole, fraction = ''] = match
  const amount = BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(fraction.padEnd(USDC_DECIMALS, '0'))
  if (amount > MAX_AMOUNT) throw new EscrowError('INVALID_AMOUNT', 'The amount is too large')
  return amount
}

export function formatUsdc(value: bigint): string {
  const scale = 10n ** BigInt(USDC_DECIMALS)
  const fraction = (value % scale).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '')
  return fraction ? `${value / scale}.${fraction}` : `${value / scale}`
}

const addressOf = (value: unknown): string => String(value)

function address(value: string): xdr.ScVal {
  return new Address(value).toScVal()
}

function contractError(message: string): EscrowError {
  const match = /Error\(Contract, #(\d+)\)/.exec(message)
  const known = match ? CONTRACT_ERRORS[Number(match[1])] : undefined
  if (known) return new EscrowError(known.code, message, known.status)
  if (message.includes('Error(Auth')) return new EscrowError('UNAUTHORIZED', message, 403)
  return new EscrowError('SIMULATION_FAILED', message, 502)
}

function toOrder(raw: Record<string, unknown>): Order {
  // Unit enum variants decode as a one-element array, e.g. ['Funded'].
  const status = Array.isArray(raw.status) ? raw.status[0] : raw.status
  return {
    id: String(raw.id),
    buyer: String(raw.buyer),
    farmer: String(raw.farmer),
    arbiter: String(raw.arbiter),
    amount: formatUsdc(raw.amount as bigint),
    deliveryDeadline: Number(raw.delivery_deadline),
    reviewWindow: Number(raw.review_window),
    reviewDeadline: Number(raw.review_deadline),
    disputeWindow: Number(raw.dispute_window),
    disputeDeadline: Number(raw.dispute_deadline),
    status: status as OrderStatus,
  }
}
