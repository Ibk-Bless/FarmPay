import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle, Circle, Copy, XCircle } from 'lucide-react'
import AppHeader from '../components/AppHeader'
import { api, errorMessage, type Order, type OrderAction, type OrderStatus } from '../lib/api'
import { formatDate, formatUsdc, shortAddress, timeLeft } from '../lib/format'
import { useWallet } from '../wallet/context'
import { STEP_LABELS, useTransaction } from '../wallet/useTransaction'

const STATUS_TEXT: Record<OrderStatus, string> = {
  Funded: 'Funds are locked. Waiting for the farmer to accept.',
  Accepted: 'The farmer accepted. Waiting for delivery.',
  Delivered: 'The farmer marked the order delivered. The buyer can confirm or dispute during the review window.',
  Disputed: 'The buyer opened a dispute. Waiting for the cooperative to decide the split.',
  Released: 'Complete. The farmer was paid in full.',
  Refunded: 'Cancelled. The buyer was refunded in full.',
  Resolved: 'Dispute resolved. The cooperative split the funds between farmer and buyer.',
}

const HAPPY_PATH: OrderStatus[] = ['Funded', 'Accepted', 'Delivered', 'Released']

export default function OrderDetail() {
  const { orderId = '' } = useParams()
  const { address, wrongNetwork } = useWallet()
  const { run, step, busy, error } = useTransaction()

  const [order, setOrder] = useState<Order | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [reason, setReason] = useState('')
  const [farmerAmount, setFarmerAmount] = useState('')
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      setOrder(await api.getOrder(orderId))
      setLoadError(null)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }, [orderId])

  useEffect(() => {
    load()
  }, [load])

  // Keep countdowns and time-based actions current.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  async function act(action: OrderAction, body: Record<string, string> = {}) {
    const result = await run(() => api.buildAction(orderId, action, body))
    if (result) {
      setReason('')
      setFarmerAmount('')
      await load()
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (loadError) {
    return (
      <Shell>
        <p className="text-red-700 bg-red-50 border border-red-200 rounded-lg p-4">{loadError}</p>
      </Shell>
    )
  }
  if (!order) {
    return (
      <Shell>
        <p className="text-gray-500">Loading order #{orderId}…</p>
      </Shell>
    )
  }

  const nowSeconds = now / 1000
  const role = address === order.buyer ? 'buyer' : address === order.farmer ? 'farmer' : address === order.arbiter ? 'arbiter' : null
  const reviewOpen = order.status === 'Delivered' && nowSeconds <= order.reviewDeadline
  const reviewOver = order.status === 'Delivered' && nowSeconds > order.reviewDeadline
  const deliveryLate = order.status === 'Accepted' && nowSeconds > order.deliveryDeadline
  const disabled = busy || wrongNetwork

  const actions: ReactNode[] = []
  if (role === 'farmer' && order.status === 'Funded') {
    actions.push(<ActionButton key="accept" onClick={() => act('accept')} disabled={disabled}>Accept order</ActionButton>)
  }
  if (role === 'farmer' && order.status === 'Accepted') {
    actions.push(<ActionButton key="deliver" onClick={() => act('deliver')} disabled={disabled}>Mark as delivered</ActionButton>)
  }
  if (role === 'buyer' && (order.status === 'Funded' || deliveryLate)) {
    actions.push(
      <ActionButton key="cancel" variant="secondary" onClick={() => act('cancel')} disabled={disabled}>
        Cancel and refund {formatUsdc(order.amount)}
      </ActionButton>,
    )
  }
  if (role === 'buyer' && order.status === 'Delivered') {
    actions.push(
      <ActionButton key="confirm" onClick={() => act('confirm')} disabled={disabled}>
        Confirm delivery and pay farmer
      </ActionButton>,
    )
  }
  if (address && reviewOver) {
    actions.push(
      <ActionButton key="claim" onClick={() => act('claim', role === 'farmer' ? {} : { caller: address })} disabled={disabled}>
        Release payment to farmer
      </ActionButton>,
    )
  }

  return (
    <Shell>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-gray-500">Order #{order.id}</p>
          <h1 className="text-3xl font-bold text-gray-900">{formatUsdc(order.amount)}</h1>
        </div>
        <button onClick={copyLink} className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-green-700">
          <Copy className="h-4 w-4" />
          {copied ? 'Link copied' : 'Copy link'}
        </button>
      </div>

      <StatusTrack status={order.status} />
      <p className="mt-4 text-gray-700">{STATUS_TEXT[order.status]}</p>

      <dl className="mt-6 grid sm:grid-cols-2 gap-4 bg-white border border-gray-200 rounded-xl p-6 text-sm">
        <Party label="Buyer" value={order.buyer} you={role === 'buyer'} />
        <Party label="Farmer" value={order.farmer} you={role === 'farmer'} />
        <Party label="Cooperative (arbiter)" value={order.arbiter} you={role === 'arbiter'} />
        <div>
          <dt className="text-gray-500">Deliver by</dt>
          <dd className="text-gray-900">{formatDate(order.deliveryDeadline)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Review window</dt>
          <dd className="text-gray-900">
            {order.reviewDeadline === 0
              ? `${order.reviewWindow / 3600} hours, starting at delivery`
              : `Until ${formatDate(order.reviewDeadline)}`}
            {reviewOpen && <span className="ml-2 text-green-700 font-medium">({timeLeft(order.reviewDeadline, now)} left)</span>}
          </dd>
        </div>
      </dl>

      <section className="mt-6 bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="font-semibold text-gray-900">Your actions</h2>
        {!address ? (
          <p className="text-gray-600 mt-2 text-sm">Connect your wallet to act on this order.</p>
        ) : (
          <>
            {!role && !reviewOver && (
              <p className="text-gray-600 mt-2 text-sm">Your connected account is not part of this order.</p>
            )}
            {actions.length > 0 && <div className="mt-4 flex flex-wrap gap-3">{actions}</div>}

            {role === 'buyer' && reviewOpen && (
              <div className="mt-6 border-t border-gray-100 pt-5">
                <label htmlFor="reason" className="block text-sm font-medium text-gray-700 mb-1">
                  Something wrong with the delivery? Open a dispute
                </label>
                <textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. 200kg short of the agreed quantity"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                <div className="mt-3">
                  <ActionButton variant="danger" onClick={() => act('dispute', { reason })} disabled={disabled || !reason.trim()}>
                    Open dispute
                  </ActionButton>
                </div>
              </div>
            )}

            {role === 'arbiter' && order.status === 'Disputed' && (
              <div className="mt-4">
                <label htmlFor="split" className="block text-sm font-medium text-gray-700 mb-1">
                  Farmer's share (USDC, out of {formatUsdc(order.amount)})
                </label>
                <input id="split" inputMode="decimal" value={farmerAmount} onChange={(e) => setFarmerAmount(e.target.value.trim())}
                  placeholder="e.g. 800"
                  className="w-full sm:w-64 border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500" />
                {farmerAmount && Number(farmerAmount) <= Number(order.amount) && (
                  <p className="text-xs text-gray-500 mt-1">
                    The buyer is refunded {(Number(order.amount) - Number(farmerAmount)).toFixed(2)} USDC.
                  </p>
                )}
                <div className="mt-3">
                  <ActionButton onClick={() => act('resolve', { farmerAmount })} disabled={disabled || !farmerAmount}>
                    Resolve dispute
                  </ActionButton>
                </div>
              </div>
            )}

            {role && actions.length === 0 && !(role === 'buyer' && reviewOpen) && !(role === 'arbiter' && order.status === 'Disputed') && (
              <p className="text-gray-600 mt-2 text-sm">Nothing for you to do right now.</p>
            )}
          </>
        )}

        {wrongNetwork && (
          <p className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
            Switch Freighter to Testnet to sign.
          </p>
        )}
        {busy && <p className="mt-4 text-sm text-gray-600">{STEP_LABELS[step]}</p>}
        {error && <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}
      </section>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">{children}</main>
    </div>
  )
}

function Party({ label, value, you }: { label: string; value: string; you: boolean }) {
  return (
    <div>
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-mono text-gray-900" title={value}>
        {shortAddress(value)}
        {you && <span className="ml-2 font-sans text-xs font-medium bg-green-100 text-green-800 px-2 py-0.5 rounded">you</span>}
      </dd>
    </div>
  )
}

function StatusTrack({ status }: { status: OrderStatus }) {
  // Refunded / Disputed / Resolved branch off the happy path after the last state reached.
  const branch: Partial<Record<OrderStatus, { after: OrderStatus; ok: boolean }>> = {
    Refunded: { after: 'Funded', ok: false },
    Disputed: { after: 'Delivered', ok: false },
    Resolved: { after: 'Delivered', ok: true },
  }
  const detour = branch[status]
  const reached = HAPPY_PATH.indexOf(detour ? detour.after : status)
  const steps = detour ? [...HAPPY_PATH.slice(0, reached + 1), status] : HAPPY_PATH

  return (
    <ol className="mt-6 flex flex-wrap items-center gap-2 text-sm">
      {steps.map((s, i) => {
        const done = detour ? true : i <= reached
        const icon =
          s === status && detour && !detour.ok ? <XCircle className="h-5 w-5 text-amber-500" />
          : done ? <CheckCircle className="h-5 w-5 text-green-600" />
          : <Circle className="h-5 w-5 text-gray-300" />
        return (
          <li key={s} className="flex items-center gap-2">
            {i > 0 && <span className="w-6 h-px bg-gray-300" />}
            {icon}
            <span className={done ? 'text-gray-900 font-medium' : 'text-gray-400'}>{s}</span>
          </li>
        )
      })}
    </ol>
  )
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'danger'
}) {
  const styles = {
    primary: 'bg-green-600 text-white hover:bg-green-700',
    secondary: 'border-2 border-gray-300 text-gray-700 hover:bg-gray-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  }[variant]
  return (
    <button onClick={onClick} disabled={disabled}
      className={`${styles} px-5 py-2.5 rounded-lg font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed`}>
      {children}
    </button>
  )
}
