import { useCallback, useState } from 'react'
import { api, errorMessage, type BuiltTransaction, type SubmitResult } from '../lib/api'
import { useWallet } from './context'

export type TxStep = 'idle' | 'building' | 'signing' | 'submitting'

/** Build → sign in wallet → submit, with progress and a readable error. */
export function useTransaction() {
  const { sign } = useWallet()
  const [step, setStep] = useState<TxStep>('idle')
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (build: () => Promise<BuiltTransaction>): Promise<SubmitResult | null> => {
      setError(null)
      try {
        setStep('building')
        const { xdr } = await build()
        setStep('signing')
        const signed = await sign(xdr)
        setStep('submitting')
        return await api.submit(signed)
      } catch (err) {
        setError(errorMessage(err))
        return null
      } finally {
        setStep('idle')
      }
    },
    [sign],
  )

  return { run, step, busy: step !== 'idle', error, clearError: () => setError(null) }
}

export const STEP_LABELS: Record<TxStep, string> = {
  idle: '',
  building: 'Preparing transaction…',
  signing: 'Approve in your wallet…',
  submitting: 'Confirming on Stellar…',
}
