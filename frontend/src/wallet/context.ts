import { createContext, useContext } from 'react'

export const NETWORK_PASSPHRASE =
  import.meta.env.VITE_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015'

export type WalletStatus = 'loading' | 'not-installed' | 'disconnected' | 'connected'

export interface WalletState {
  status: WalletStatus
  address: string | null
  /** True when the wallet is connected to a different network than FarmPay. */
  wrongNetwork: boolean
  connect: () => Promise<void>
  disconnect: () => void
  /** Ask the wallet to sign a transaction; resolves with the signed XDR. */
  sign: (xdr: string) => Promise<string>
}

export const WalletContext = createContext<WalletState | null>(null)

export function useWallet(): WalletState {
  const wallet = useContext(WalletContext)
  if (!wallet) throw new Error('useWallet must be used inside <WalletProvider>')
  return wallet
}
