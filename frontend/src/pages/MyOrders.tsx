import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import OrderCard from '../components/OrderCard'
import WalletButton from '../components/WalletButton'
import { api, errorMessage, type ListedOrder, type OrderAction, type OrderList, type OrderRole } from '../lib/api'
import { clock, useNow } from '../lib/clock'
import { applyAction, sectionOf, summarize, type Section } from '../lib/orderSteps'
import { useWallet } from '../wallet/context'

const COPY: Record<OrderRole | 'all', { title: string; blurb: string }> = {
  all: { title: 'My orders', blurb: 'Every order you take part in, and what each one needs from you.' },
  buyer: { title: 'Buyer dashboard', blurb: 'Orders you have placed, and what each one is waiting on.' },
  farmer: { title: 'Farmer dashboard', blurb: 'Orders placed with you: what to accept, deliver and claim.' },
  arbiter: { title: 'Cooperative dashboard', blurb: 'Disputes waiting for your ruling, and the orders of your members.' },
}

const SECTIONS: { id: Section; title: string }[] = [
  { id: 'action', title: 'Needs your action' },
  { id: 'waiting', title: 'Waiting on others' },
  { id: 'done', title: 'Completed' },
]

const POLL_WHILE_LOADING_MS = 2000
// The index is a few seconds behind the chain, so after an action the list shows the expected
// new state straight away, and checks the server again shortly after.
const SHOW_EXPECTED_FOR_MS = 20_000
const RECHECK_AFTER_MS = 8_000

export default function MyOrders({ role }: { role?: OrderRole }) {
  const copy = COPY[role ?? 'all']
  const { status, address } = useWallet()
  const now = useNow()

  const [data, setData] = useState<OrderList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expected, setExpected] = useState<Record<string, { order: ListedOrder; until: number }>>({})
  const latestRequest = useRef(0)

  const load = useCallback(async () => {
    if (!address) return
    const request = ++latestRequest.current
    try {
      const list = await api.listOrders(address)
      if (request === latestRequest.current) {
        setData(list)
        setError(null)
      }
    } catch (err) {
      if (request === latestRequest.current) setError(errorMessage(err))
    }
  }, [address])

  // Start fresh whenever the connected account changes.
  useEffect(() => {
    latestRequest.current++
    setData(null)
    setError(null)
    setExpected({})
    load()
  }, [load])

  // While the server is still doing its first read of the chain, ask again until it has.
  useEffect(() => {
    if (!data || data.synced) return
    const timer = setTimeout(load, POLL_WHILE_LOADING_MS)
    return () => clearTimeout(timer)
  }, [data, load])

  function onDone(order: ListedOrder, action: OrderAction) {
    // Time is read from the app's clock (not Date.now), so this stays consistent with `now` above,
    // including in the demo where the clock can be moved forward.
    const at = clock.now()
    setExpected((current) => ({
      ...current,
      [order.id]: { order: applyAction(order, action, Math.floor(at / 1000)), until: at + SHOW_EXPECTED_FOR_MS },
    }))
    setTimeout(load, RECHECK_AFTER_MS)
  }

  const grouped = useMemo(() => {
    const groups: Record<Section, { order: ListedOrder; step: ReturnType<typeof summarize> }[]> = { action: [], waiting: [], done: [] }
    const nowSeconds = now / 1000
    for (const listed of data?.orders ?? []) {
      if (role && listed.role !== role) continue
      const pending = expected[listed.id]
      const order = pending && pending.until > now ? pending.order : listed
      const step = summarize(order, order.role, nowSeconds)
      groups[sectionOf(order, step)].push({ order, step })
    }
    // What is due soonest comes first; everything else keeps newest-first order.
    groups.action.sort((a, b) => (a.step.until ?? Infinity) - (b.step.until ?? Infinity) || Number(b.order.id) - Number(a.order.id))
    return groups
  }, [data, expected, role, now])

  const total = SECTIONS.reduce((sum, s) => sum + grouped[s.id].length, 0)

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <h1 className="text-3xl font-bold text-gray-900">{copy.title}</h1>
        <p className="text-gray-600 mt-2">{copy.blurb}</p>

        {status !== 'connected' || !address ? (
          <div className="mt-8 bg-white border border-gray-200 rounded-xl p-8 text-center">
            <p className="text-gray-700 mb-4">Connect your wallet to see your orders.</p>
            <div className="flex justify-center">
              <WalletButton />
            </div>
          </div>
        ) : error ? (
          <div className="mt-8">
            <p role="alert" className="text-red-700 bg-red-50 border border-red-200 rounded-lg p-4">
              {error}
            </p>
            <button
              onClick={load}
              className="mt-4 border-2 border-gray-300 text-gray-700 px-5 py-2.5 rounded-lg font-semibold hover:bg-gray-50 transition"
            >
              Try again
            </button>
          </div>
        ) : !data || (!data.synced && data.orders.length === 0) ? (
          <p role="status" className="mt-8 text-gray-600">
            Loading your orders…
          </p>
        ) : total === 0 ? (
          <div className="mt-8 bg-white border border-gray-200 rounded-xl p-8 text-center">
            <p className="text-gray-900 font-semibold">No orders yet</p>
            {role === 'farmer' ? (
              <p className="text-gray-600 mt-2 break-all">
                Orders placed with you appear here. Share your account address with a buyer: <span className="font-mono text-sm">{address}</span>
              </p>
            ) : role === 'arbiter' ? (
              <p className="text-gray-600 mt-2 break-all">
                Orders that name you as the cooperative appear here. Share your account address: <span className="font-mono text-sm">{address}</span>
              </p>
            ) : (
              <p className="text-gray-600 mt-2">Create an order to lock funds for a farmer.</p>
            )}
            {role !== 'farmer' && role !== 'arbiter' && (
              <Link
                to="/order/create"
                className="mt-5 inline-block bg-green-700 text-white px-5 py-2.5 rounded-lg font-semibold hover:bg-green-800 transition"
              >
                Create an order
              </Link>
            )}
          </div>
        ) : (
          <div className="mt-8 space-y-10">
            {SECTIONS.filter((s) => grouped[s.id].length > 0).map((s) => (
              <section key={s.id} aria-labelledby={`section-${s.id}`}>
                <h2 id={`section-${s.id}`} className="text-lg font-semibold text-gray-900 mb-3">
                  {s.title} <span className="text-gray-600 font-normal">({grouped[s.id].length})</span>
                </h2>
                <ul className="space-y-4">
                  {grouped[s.id].map(({ order, step }) => (
                    <OrderCard key={order.id} order={order} step={step} now={now} onDone={onDone} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
