import { createContext, useContext } from 'react'
import type { DemoRole } from './accounts'

export interface DemoState {
  role: DemoRole
  setRole: (role: DemoRole) => void
}

export const DemoContext = createContext<DemoState | null>(null)

export function useDemo(): DemoState {
  const demo = useContext(DemoContext)
  if (!demo) throw new Error('useDemo must be used inside <DemoProvider>')
  return demo
}
