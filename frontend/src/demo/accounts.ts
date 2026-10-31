// Fake accounts for the interactive demo. They are valid-looking Stellar addresses but belong
// to nobody: nothing in the demo touches a blockchain.
const account = (prefix: string) => prefix.padEnd(56, 'A')

export const DEMO_ACCOUNTS = {
  buyer: account('GBUYER'),
  farmer: account('GFARMER'),
  cooperative: account('GCOOP'),
} as const

export type DemoRole = keyof typeof DEMO_ACCOUNTS | 'visitor'

export const ROLE_LABELS: Record<DemoRole, string> = {
  buyer: 'Buyer',
  farmer: 'Farmer',
  cooperative: 'Cooperative (arbiter)',
  visitor: 'Visitor (no wallet)',
}
