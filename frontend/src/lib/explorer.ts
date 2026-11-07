import { isDemo } from './mode'

const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015'

/** The network segment of a stellar.expert URL, taken from the same setting the wallet check uses. */
export function explorerNetwork(passphrase: string): 'public' | 'testnet' {
  return passphrase === MAINNET_PASSPHRASE ? 'public' : 'testnet'
}

/** Where anyone can verify a transaction. Returns null in the demo, whose hashes are made up. */
export function explorerTxUrl(hash: string, passphrase: string): string | null {
  if (isDemo || !/^[0-9a-f]{64}$/i.test(hash)) return null
  return `https://stellar.expert/explorer/${explorerNetwork(passphrase)}/tx/${hash}`
}
