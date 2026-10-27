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
  status: OrderStatus
}

export interface CreateOrderParams {
  buyer: string
  farmer: string
  arbiter: string
  amount: bigint
  deliveryDeadline: number
  reviewWindow: number
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

const rpcUnavailable = () =>
  new EscrowError('RPC_UNAVAILABLE', "Can't reach the Stellar network right now. Please try again in a moment.", 503)

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

  constructor(
    rpcUrl: string,
    private networkPassphrase: string,
    private contractId: string,
  ) {
    this.server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') })
    this.contract = new Contract(contractId)
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

    const sent = await this.rpc(() => this.server.sendTransaction(tx))
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
      source = await this.server.getAccount(signer)
    } catch {
      // The SDK reports every failure here as "account not found", including an unreachable RPC.
      // Check which it really is, so a network blip doesn't tell a funded user their account is gone.
      if (await this.isUnreachable()) throw rpcUnavailable()
      throw new EscrowError('ACCOUNT_NOT_FOUND', `Account ${signer} does not exist on the network`, 404)
    }
    try {
      const prepared = await this.server.prepareTransaction(this.transaction(source, method, args))
      return prepared.toXDR()
    } catch (err) {
      if (isNetworkFailure(err)) throw rpcUnavailable()
      throw contractError(err instanceof Error ? err.message : String(err))
    }
  }

  /** Runs an RPC call, turning connection failures into a clear 503. */
  private async rpc<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call()
    } catch (err) {
      if (isNetworkFailure(err)) throw rpcUnavailable()
      throw err
    }
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
    status: status as OrderStatus,
  }
}
