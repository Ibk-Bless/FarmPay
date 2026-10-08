// Typed client for the FarmPay backend (docs/API.md).

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

export interface CreateOrderInput {
  buyer: string
  farmer: string
  arbiter: string
  amount: string
  deliveryDeadline: string
  reviewWindowHours: number
}

export type OrderAction = 'accept' | 'cancel' | 'deliver' | 'confirm' | 'claim' | 'dispute' | 'resolve'

export interface BuiltTransaction {
  xdr: string
}

export interface SubmitResult {
  hash: string
  orderId?: string
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(body.error?.code ?? 'HTTP_ERROR', body.error?.message ?? `Request failed (${res.status})`)
  }
  return body as T
}

export const api = {
  getOrder: (id: string) => request<Order>(`/orders/${encodeURIComponent(id)}`),

  buildCreateOrder: (input: CreateOrderInput) =>
    request<BuiltTransaction>('/orders', { method: 'POST', body: JSON.stringify(input) }),

  buildAction: (id: string, action: OrderAction, body: Record<string, string> = {}) =>
    request<BuiltTransaction>(`/orders/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  submit: (signedXdr: string) =>
    request<SubmitResult>('/transactions', { method: 'POST', body: JSON.stringify({ signedXdr }) }),
}

// User-facing messages for the API's error codes.
const MESSAGES: Record<string, string> = {
  INVALID_STATUS: 'This action is not available for the order in its current state.',
  TOO_EARLY: 'Too early: the deadline for this action has not passed yet.',
  TOO_LATE: 'Too late: the review window has closed.',
  INVALID_PARTIES: 'Buyer, farmer and cooperative must be three different accounts.',
  INVALID_DEADLINE: 'The delivery deadline must be in the future.',
  INVALID_AMOUNT: 'Enter a positive USDC amount with up to 7 decimals.',
  INVALID_SPLIT: "The farmer's share must be between 0 and the order amount.",
  INVALID_ADDRESS: 'Enter a valid Stellar account address (starts with G).',
  ACCOUNT_NOT_FOUND: 'Your account is not funded on testnet yet.',
  ORDER_NOT_FOUND: 'No order with this number exists.',
  UNAUTHORIZED: 'Your account is not allowed to take this action.',
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return MESSAGES[err.code] ?? err.message
  if (err instanceof Error) return err.message
  return String(err)
}
