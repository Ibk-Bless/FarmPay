import { CheckCircle2 } from 'lucide-react'
import { explorerTxUrl } from '../lib/explorer'
import { isDemo } from '../lib/mode'
import { NETWORK_PASSPHRASE } from '../wallet/context'

/** Confirms a submitted transaction and, on a real network, links to it so anyone can verify it. */
export default function TxReceipt({ hash }: { hash: string }) {
  const url = explorerTxUrl(hash, NETWORK_PASSPHRASE)
  return (
    <p className="mt-4 flex items-start gap-2 text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg p-3">
      <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span>
        Transaction confirmed.{' '}
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="underline font-medium">
            View on stellar.expert<span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : isDemo ? (
          'This is a simulated demo, so there is nothing on the network to look up.'
        ) : null}
      </span>
    </p>
  )
}
