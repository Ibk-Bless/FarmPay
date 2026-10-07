import { useState } from 'react'
import { Wallet } from 'lucide-react'
import { useWallet } from '../wallet/context'
import { shortAddress } from '../lib/format'

export default function WalletButton() {
  const { status, address, wrongNetwork, connect, disconnect } = useWallet()
  const [error, setError] = useState<string | null>(null)

  if (status === 'loading') {
    return <span className="text-sm text-gray-400">Checking wallet…</span>
  }

  if (status === 'not-installed') {
    return (
      <a
        href="https://www.freighter.app/"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 border-2 border-green-600 text-green-700 px-4 py-2 rounded-lg hover:bg-green-50 transition"
      >
        <Wallet className="h-4 w-4" />
        Install Freighter
      </a>
    )
  }

  if (status === 'disconnected' || !address) {
    return (
      <div className="flex flex-col items-end">
        <button
          onClick={() => connect().then(() => setError(null), (err: Error) => setError(err.message))}
          className="inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition"
        >
          <Wallet className="h-4 w-4" />
          Connect wallet
        </button>
        {error && <span className="text-xs text-red-600 mt-1">{error}</span>}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      {wrongNetwork && (
        <span className="text-xs font-medium bg-amber-100 text-amber-800 px-2 py-1 rounded">
          Switch Freighter to Testnet
        </span>
      )}
      <span className="inline-flex items-center gap-2 bg-green-50 text-green-800 border border-green-200 px-3 py-2 rounded-lg font-mono text-sm">
        <span className="h-2 w-2 rounded-full bg-green-500" />
        {shortAddress(address)}
      </span>
      <button onClick={disconnect} className="text-sm text-gray-500 hover:text-gray-800">
        Disconnect
      </button>
    </div>
  )
}
