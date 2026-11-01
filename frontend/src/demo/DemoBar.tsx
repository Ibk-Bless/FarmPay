import { clock, useNow } from '../lib/clock'
import { advanceDemoClock, resetDemo } from './demoApi'

const DAY_MS = 24 * 60 * 60 * 1000

export default function DemoBar() {
  useNow() // re-render when the demo clock moves
  const days = Math.round(clock.offsetMs / DAY_MS)

  return (
    <section aria-label="Demo controls" className="bg-amber-100 border-b border-amber-300 text-amber-950 text-sm">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>
            <strong>Interactive demo.</strong> Everything here is simulated in your browser: no wallet, no
            blockchain, no real money. Real orders run on Stellar testnet.
          </p>
          <div className="flex items-center gap-3">
            <span>Demo clock: {days === 0 ? 'now' : `+${days} day${days === 1 ? '' : 's'}`}</span>
            <button
              onClick={() => advanceDemoClock(DAY_MS)}
              className="bg-amber-900 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-amber-950 transition"
            >
              Skip ahead 1 day
            </button>
            <button
              onClick={() => {
                resetDemo()
                window.location.hash = '#/'
                window.location.reload()
              }}
              className="border-2 border-amber-900 text-amber-950 px-3 py-1.5 rounded-lg font-medium hover:bg-amber-200 transition"
            >
              Reset demo
            </button>
          </div>
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer font-medium">What to try</summary>
          <ol className="list-decimal list-inside mt-2 space-y-1">
            <li>As the <strong>Farmer</strong>, open order #3 and accept it, then mark it delivered.</li>
            <li>As the <strong>Buyer</strong>, confirm delivery, or open a dispute with a reason.</li>
            <li>As the <strong>Cooperative</strong>, resolve the dispute by splitting the funds.</li>
            <li>
              Deliver an order and do nothing as the buyer, then <strong>skip ahead 3 days</strong>: the farmer can
              now claim payment, and the buyer can no longer dispute.
            </li>
            <li>
              Open a dispute and have nobody rule, then <strong>skip ahead past the dispute deadline</strong> (7 days
              by default): the cooperative can no longer rule, and anyone can settle it with an even split.
            </li>
            <li>As the <strong>Buyer</strong>, create your own order from the header.</li>
          </ol>
        </details>
      </div>
    </section>
  )
}
