import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import WalletButton from '../components/WalletButton'
import { api } from '../lib/api'
import { useWallet } from '../wallet/context'
import { STEP_LABELS, useTransaction } from '../wallet/useTransaction'

const ACCOUNT_PATTERN = /^G[A-Z2-7]{55}$/

const REVIEW_WINDOWS = [
  { hours: 24, label: '24 hours' },
  { hours: 48, label: '48 hours' },
  { hours: 72, label: '72 hours (recommended)' },
  { hours: 168, label: '7 days' },
]

function defaultDeliveryDate(): string {
  const date = new Date(Date.now() + 7 * 86400 * 1000)
  return date.toISOString().slice(0, 10)
}

export default function OrderCreation() {
  const navigate = useNavigate()
  const { status, address, wrongNetwork } = useWallet()
  const { run, step, busy, error } = useTransaction()

  const [farmer, setFarmer] = useState('')
  const [arbiter, setArbiter] = useState('')
  const [amount, setAmount] = useState('')
  const [deliveryDate, setDeliveryDate] = useState(defaultDeliveryDate)
  const [reviewWindowHours, setReviewWindowHours] = useState(72)
  const [formError, setFormError] = useState<string | null>(null)

  function validate(): string | null {
    if (!ACCOUNT_PATTERN.test(farmer)) return "Enter the farmer's Stellar address (starts with G)."
    if (!ACCOUNT_PATTERN.test(arbiter)) return "Enter the cooperative's Stellar address (starts with G)."
    if (new Set([address, farmer, arbiter]).size !== 3) {
      return 'You, the farmer and the cooperative must be three different accounts.'
    }
    if (!/^\d+(\.\d{1,7})?$/.test(amount) || Number(amount) <= 0) return 'Enter a positive USDC amount.'
    return null
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!address) return
    const problem = validate()
    setFormError(problem)
    if (problem) return

    // Deadline is the end of the chosen day in the buyer's local time.
    const deadline = new Date(`${deliveryDate}T23:59:59`)
    const result = await run(() =>
      api.buildCreateOrder({
        buyer: address,
        farmer,
        arbiter,
        amount,
        deliveryDeadline: deadline.toISOString(),
        reviewWindowHours,
      }),
    )
    if (result?.orderId) navigate(`/order/${result.orderId}`)
  }

  const input =
    'w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500'

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <h1 className="text-3xl font-bold text-gray-900">Create an order</h1>
        <p className="text-gray-600 mt-2">
          The USDC moves into the escrow contract when you sign. The farmer sees it is funded before accepting.
        </p>

        {status !== 'connected' ? (
          <div className="mt-8 bg-white border border-gray-200 rounded-xl p-8 text-center">
            <p className="text-gray-700 mb-4">Connect the wallet that will pay for this order.</p>
            <div className="flex justify-center">
              <WalletButton />
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-8 bg-white border border-gray-200 rounded-xl p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="farmer">
                Farmer's address
              </label>
              <input id="farmer" className={`${input} font-mono text-sm`} placeholder="G…" value={farmer}
                onChange={(e) => setFarmer(e.target.value.trim())} />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="arbiter">
                Cooperative's address <span className="font-normal text-gray-500">(settles disputes)</span>
              </label>
              <input id="arbiter" className={`${input} font-mono text-sm`} placeholder="G…" value={arbiter}
                onChange={(e) => setArbiter(e.target.value.trim())} />
            </div>

            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="amount">
                  Amount (USDC)
                </label>
                <input id="amount" className={input} inputMode="decimal" placeholder="1840.50" value={amount}
                  onChange={(e) => setAmount(e.target.value.trim())} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="deadline">
                  Deliver by
                </label>
                <input id="deadline" type="date" className={input} value={deliveryDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setDeliveryDate(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="window">
                Review window after delivery
              </label>
              <select id="window" className={input} value={reviewWindowHours}
                onChange={(e) => setReviewWindowHours(Number(e.target.value))}>
                {REVIEW_WINDOWS.map((w) => (
                  <option key={w.hours} value={w.hours}>{w.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Time you have to confirm or dispute once the farmer marks the order delivered. After that, the
                farmer can claim the payment.
              </p>
            </div>

            {wrongNetwork && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Your wallet is on a different network. Switch Freighter to Testnet before signing.
              </p>
            )}
            {(formError || error) && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{formError ?? error}</p>
            )}

            <button type="submit" disabled={busy || wrongNetwork}
              className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
              {busy ? STEP_LABELS[step] : 'Lock funds and create order'}
            </button>
          </form>
        )}
      </main>
    </div>
  )
}
