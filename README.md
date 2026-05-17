# FarmPay 🌾

**Instant farm-to-buyer settlement on Stellar — because a farmer who delivers today shouldn't wait 60 days to get paid.**

## The Problem

Farming is one of the few businesses where you do all the work first and get paid last. Smallholder farmers deliver their harvest but wait 30-90 days for payment, forcing them to borrow at punishing rates just to cover immediate costs.

## The Solution

FarmPay puts a Stellar-powered escrow between every farm delivery and buyer payment:

- **Buyer creates order** → locks payment in Stellar escrow
- **Farmer accepts** → sees funds are secured before delivery
- **Delivery confirmed** → escrow releases instantly to farmer's wallet
- **On-chain history** → farmers build verifiable delivery records

## Why Stellar?

- **Real escrow** — programmable, neutral, enforceable
- **5-second finality** — instant payment on delivery confirmation
- **USDC support** — stable, cross-border payments
- **Near-zero fees** — viable for small orders (~$0.0007/tx)
- **Permanent records** — portable delivery history farmers own

## Tech Stack

- **Blockchain**: Stellar (Horizon API, Stellar SDK)
- **Smart Contracts**: Soroban (escrow logic)
- **Payments**: USDC on Stellar, XLM
- **Frontend**: TypeScript + React + Vite
- **Backend**: Node.js + Express + Stellar SDK
- **Database**: PostgreSQL

## Project Structure

```
farmpay/
├── contracts/          # Soroban escrow contracts
├── frontend/           # React web application
├── backend/            # Node.js API server
└── docs/              # Documentation
```

## Getting Started

### Prerequisites

- Node.js 18+
- Rust (for Soroban contracts)
- PostgreSQL
- Stellar account (testnet for development)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd farmpay

# Install frontend dependencies
cd frontend
npm install

# Install backend dependencies
cd ../backend
npm install

# Build Soroban contracts
cd ../contracts/escrow
cargo build --target wasm32-unknown-unknown --release
```

### Development

```bash
# Start backend (from backend/)
npm run dev

# Start frontend (from frontend/)
npm run dev
```

## Roadmap

- [x] Project concept and architecture
- [ ] Landing page deployed
- [ ] Soroban escrow contract (lock + release + dispute window)
- [ ] Purchase order creation (buyer flow)
- [ ] Order acceptance (farmer flow)
- [ ] Delivery confirmation + escrow release trigger
- [ ] Farmer delivery profile (public shareable page)
- [ ] Buyer dashboard
- [ ] Farmer dashboard
- [ ] Dispute handling flow
- [ ] Testnet end-to-end demo
- [ ] Cross-border USDC payment support
- [ ] Microfinance credit signal layer (future)

## Target Users

- **Smallholder farmers** in Africa, Southeast Asia, and Latin America
- **Agricultural buyers** — wholesalers, exporters, food processors
- **Agricultural cooperatives** offering structured payment systems
- **Microfinance institutions** seeking verified farmer track records

## License

MIT

## Contact

For questions or collaboration: [Your contact information]
