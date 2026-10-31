/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NETWORK_PASSPHRASE?: string
  /** 'true' in the interactive demo build */
  readonly VITE_DEMO?: string
}
