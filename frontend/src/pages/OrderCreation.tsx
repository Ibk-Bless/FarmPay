import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import WalletButton from '../components/WalletButton'
import { api } from '../lib/api'
import { useWallet } from '../wallet/context'
import { DEMO_ACCOUNTS } from '../demo/accounts'
import { isDemo } from '../lib/mode'
import { STEP_LABELS, useTransaction } from '../wallet/useTransaction'

const ACCOUNT_PATTERN = /^G[A-Z2-7]{55}$/

const REVIEW_WINDOWS = [
  { hours: 24, label: '24 hours' },
  { hours: 48, label: '48 hours' },
  { hours: 72, label: '72 hours (recommended)' },
  { hours: 168, label: '7 days' },
]

const DISPUTE_WINDOWS = [
  { days: 1, label: '1 day' },
  { days: 3, label: '3 days' },
  { days: 7, label: '7 days (recommended)' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
]

function defaultDeliveryDate(): string {
  const date = new Date(Date.now() + 7 * 86400 * 1000)
  return date.toISOString().slice(0, 10)
}

export default function OrderCreation() {
  const navigate = useNavigate()
  const { status, address, wrongNetwork } = useWallet()
  const { run, step, busy, error } = useTransaction()

  // The demo prefills its fake farmer and cooperative so a visitor can create an order in one click.
  const [farmer, setFarmer] = useState(isDemo ? DEMO_ACCOUNTS.farmer : '')
  const [arbiter, setArbiter] = useState(isDemo ? DEMO_ACCOUNTS.cooperative : '')
  const [amount, setAmount] = useState(isDemo ? '250' : '')
  const [deliveryDate, setDeliveryDate] = useState(defaultDeliveryDate)
  const [reviewWindowHours, setReviewWindowHours] = useState(72)
  const [disputeWindowDays, setDisputeWindowDays] = useState(7)
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

  const submitButton = useRef<HTMLButtonElement>(null)

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
        disputeWindowDays,
      }),
    )
    if (result?.orderId) {
      navigate(`/order/${result.orderId}`)
    } else {
      // The submit button was disabled while running, which drops keyboard focus. Put it back
      // once the button is enabled again so the user can read the error and retry.
      requestAnimationFrame(() => submitButton.current?.focus())
    }
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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="dispute-window">
                Time for the cooperative to decide a dispute
              </label>
              <select id="dispute-window" className={input} value={disputeWindowDays}
                onChange={(e) => setDisputeWindowDays(Number(e.target.value))}>
                {DISPUTE_WINDOWS.map((w) => (
                  <option key={w.days} value={w.days}>{w.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                If you open a dispute and the cooperative has not ruled by then, anyone can settle it with an even
                split, so the money is never stuck.
              </p>
            </div>

            {wrongNetwork && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Your wallet is on a different network. Switch Freighter to Testnet before signing.
              </p>
            )}
            {(formError || error) && (
              <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{formError ?? error}</p>
            )}

            <button ref={submitButton} type="submit" disabled={busy || wrongNetwork}
              className="w-full bg-green-700 text-white py-3 rounded-lg font-semibold hover:bg-green-800 transition disabled:opacity-50 disabled:cursor-not-allowed">
              {busy ? STEP_LABELS[step] : 'Lock funds and create order'}
            </button>
          </form>
        )}
      </main>
    </div>
  )
}
