import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { api, type ListedOrder, type OrderAction, type OrderStatus } from '../lib/api'
import { formatUsdc, shortAddress, timeLeft } from '../lib/format'
import type { Step } from '../lib/orderSteps'
import { useWallet } from '../wallet/context'
import { STEP_LABELS, useTransaction } from '../wallet/useTransaction'

// Each status has its own colour pair; all of them meet the 4.5:1 contrast the app requires.
const BADGE: Record<OrderStatus, string> = {
  Funded: 'bg-gray-100 text-gray-800',
  Accepted: 'bg-blue-100 text-blue-900',
  Delivered: 'bg-amber-100 text-amber-900',
  Disputed: 'bg-red-100 text-red-900',
  Released: 'bg-green-100 text-green-900',
  Refunded: 'bg-gray-100 text-gray-800',
  Resolved: 'bg-purple-100 text-purple-900',
}

function counterparty(order: ListedOrder): string {
  if (order.role === 'buyer') return `Farmer ${shortAddress(order.farmer)}`
  if (order.role === 'farmer') return `Buyer ${shortAddress(order.buyer)}`
  return `Buyer ${shortAddress(order.buyer)} · Farmer ${shortAddress(order.farmer)}`
}

interface OrderCardProps {
  order: ListedOrder
  step: Step
  now: number
  /** Called after a one-click action went through, so the list can show the new state at once. */
  onDone: (order: ListedOrder, action: OrderAction) => void
}

export default function OrderCard({ order, step, now, onDone }: OrderCardProps) {
  const { address } = useWallet()
  const { run, step: txStep, busy, error } = useTransaction()
  const link = useRef<HTMLAnchorElement>(null)
  const left = step.until ? timeLeft(step.until, now) : null
  const action = step.action

  async function perform() {
    if (!action) return
    // `claim` and `expire` may be signed by anyone, so tell the API who is signing; otherwise it
    // would pick one of the order's parties, who may not be the connected account.
    const body: Record<string, string> = action.type === 'claim' || action.type === 'expire' ? { caller: address ?? '' } : {}
    const result = await run(() => api.buildAction(order.id, action.type, body))
    if (result) {
      onDone(order, action.type)
      // The button is about to disappear; keep keyboard focus on this order instead of losing it.
      requestAnimationFrame(() => link.current?.focus())
    }
  }

  return (
    <li className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            ref={link}
            to={`/order/${order.id}`}
            className="font-semibold text-gray-900 hover:text-green-800 underline decoration-gray-300 underline-offset-4"
          >
            Order #{order.id} · {formatUsdc(order.amount)}
          </Link>
          <p className="text-sm text-gray-600 mt-0.5 break-words">{counterparty(order)}</p>
        </div>
        <span className={`shrink-0 text-xs font-medium px-2 py-1 rounded ${BADGE[order.status]}`}>{order.status}</span>
      </div>

      <p className="mt-3 text-gray-800">
        {step.text}
        {left && (
          <span className="ml-2 text-green-800 font-medium whitespace-nowrap">
            ({left} {step.untilLabel})
          </span>
        )}
      </p>

      {action && (
        <button
          onClick={perform}
          disabled={busy}
          className="mt-4 w-full sm:w-auto bg-green-700 text-white px-5 py-2.5 rounded-lg font-semibold hover:bg-green-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? STEP_LABELS[txStep] : action.label}
        </button>
      )}
      {!action && step.needsAction && (
        <Link
          to={`/order/${order.id}`}
          className="mt-4 inline-block border-2 border-green-700 text-green-800 px-5 py-2.5 rounded-lg font-semibold hover:bg-green-50 transition"
        >
          Open order
        </Link>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          {error}
        </p>
      )}
    </li>
  )
}
