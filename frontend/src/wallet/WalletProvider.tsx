import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  WatchWalletChanges,
  getAddress,
  getNetworkDetails,
  isAllowed,
  isConnected,
  requestAccess,
  signTransaction,
} from '@stellar/freighter-api'
import { NETWORK_PASSPHRASE, WalletContext, type WalletStatus } from './context'

// Remembers an explicit disconnect so we don't silently reconnect on reload.
const DISCONNECTED_KEY = 'farmpay:wallet-disconnected'

function readFlag(): boolean {
  try {
    return localStorage.getItem(DISCONNECTED_KEY) === '1'
  } catch {
    return false
  }
}

function writeFlag(disconnected: boolean) {
  try {
    if (disconnected) localStorage.setItem(DISCONNECTED_KEY, '1')
    else localStorage.removeItem(DISCONNECTED_KEY)
  } catch {
    // Storage unavailable (private mode); reconnect behaviour just won't persist.
  }
}

export default function WalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>('loading')
  const [address, setAddress] = useState<string | null>(null)
  const [networkPassphrase, setNetworkPassphrase] = useState<string | null>(null)

  // On load: detect Freighter and restore a previously approved connection.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const installed = await isConnected()
      if (cancelled) return
      if (installed.error || !installed.isConnected) {
        setStatus('not-installed')
        return
      }
      const allowed = await isAllowed()
      if (!cancelled && allowed.isAllowed && !readFlag()) {
        const [addr, network] = await Promise.all([getAddress(), getNetworkDetails()])
        if (cancelled) return
        if (addr.address) {
          setAddress(addr.address)
          setNetworkPassphrase(network.networkPassphrase)
          setStatus('connected')
          return
        }
      }
      if (!cancelled) setStatus('disconnected')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Follow account and network switches made inside Freighter.
  useEffect(() => {
    if (status !== 'connected') return
    const watcher = new WatchWalletChanges(2000)
    watcher.watch(({ address: next, networkPassphrase: passphrase, error }) => {
      if (error) return
      if (next) setAddress(next)
      setNetworkPassphrase(passphrase)
    })
    return () => watcher.stop()
  }, [status])

  const connect = useCallback(async () => {
    const access = await requestAccess()
    if (access.error) throw new Error(access.error.message ?? 'Wallet connection was rejected')
    const network = await getNetworkDetails()
    writeFlag(false)
    setAddress(access.address)
    setNetworkPassphrase(network.networkPassphrase)
    setStatus('connected')
  }, [])

  const disconnect = useCallback(() => {
    // Freighter has no programmatic disconnect; we forget the session on our side.
    writeFlag(true)
    setAddress(null)
    setNetworkPassphrase(null)
    setStatus('disconnected')
  }, [])

  const sign = useCallback(
    async (xdr: string) => {
      if (!address) throw new Error('Connect your wallet first')
      const result = await signTransaction(xdr, { networkPassphrase: NETWORK_PASSPHRASE, address })
      if (result.error) throw new Error(result.error.message ?? 'Signing was rejected')
      return result.signedTxXdr
    },
    [address],
  )

  const value = useMemo(
    () => ({
      status,
      address,
      wrongNetwork: status === 'connected' && networkPassphrase !== NETWORK_PASSPHRASE,
      connect,
      disconnect,
      sign,
    }),
    [status, address, networkPassphrase, connect, disconnect, sign],
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}
