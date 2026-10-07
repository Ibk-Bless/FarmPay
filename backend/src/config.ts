import dotenv from 'dotenv'
import { Networks } from '@stellar/stellar-sdk'

dotenv.config()

export const config = {
  port: Number(process.env.PORT ?? 4000),
  rpcUrl: process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET,
  escrowContractId: process.env.ESCROW_CONTRACT_ID ?? '',
}
