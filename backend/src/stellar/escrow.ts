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
    const sim = await this.server.simulateTransaction(tx)
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

    const sent = await this.server.sendTransaction(tx)
    if (sent.status === 'ERROR' || sent.status === 'TRY_AGAIN_LATER') {
      throw new EscrowError('SUBMIT_FAILED', `Network rejected transaction (${sent.status})`, 502)
    }

    const result = await this.server.pollTransaction(sent.hash, { attempts: 30 })
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
      throw new EscrowError('ACCOUNT_NOT_FOUND', `Account ${signer} does not exist on the network`, 404)
    }
    try {
      const prepared = await this.server.prepareTransaction(this.transaction(source, method, args))
      return prepared.toXDR()
    } catch (err) {
      throw contractError(err instanceof Error ? err.message : String(err))
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

export function parseUsdc(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(value)
  if (!match) throw new EscrowError('INVALID_AMOUNT', `"${value}" is not a valid USDC amount`)
  const [, whole, fraction = ''] = match
  return BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(fraction.padEnd(USDC_DECIMALS, '0'))
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
