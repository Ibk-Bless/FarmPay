import { useMemo, useState, type ReactNode } from 'react'
import { WalletContext, type WalletState } from '../wallet/context'
import { DEMO_ACCOUNTS, type DemoRole } from './accounts'
import { DemoContext } from './context'

const ROLE_KEY = 'farmpay:demo:role'
const ROLES: DemoRole[] = ['buyer', 'farmer', 'cooperative', 'visitor']

function initialRole(): DemoRole {
  try {
    const saved = sessionStorage.getItem(ROLE_KEY) as DemoRole | null
    if (saved && ROLES.includes(saved)) return saved
  } catch {
    // Storage unavailable: fall back to the default.
  }
  return 'buyer'
}

/**
 * Demo replacement for the Freighter wallet provider. "Connecting" is choosing a role, and
 * "signing" is a no-op: the demo API accepts the token it handed out.
 */
export default function DemoProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<DemoRole>(initialRole)

  const demo = useMemo(
    () => ({
      role,
      setRole: (next: DemoRole) => {
        setRoleState(next)
        try {
          sessionStorage.setItem(ROLE_KEY, next)
        } catch {
          // Not persisted; the choice still applies for this visit.
        }
      },
    }),
    [role],
  )

  const wallet = useMemo<WalletState>(
    () => ({
      status: role === 'visitor' ? 'disconnected' : 'connected',
      address: role === 'visitor' ? null : DEMO_ACCOUNTS[role],
      wrongNetwork: false,
      connect: async () => demo.setRole('buyer'),
      disconnect: () => demo.setRole('visitor'),
      sign: async (xdr: string) => xdr,
    }),
    [role, demo],
  )

  return (
    <DemoContext.Provider value={demo}>
      <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>
    </DemoContext.Provider>
  )
}
