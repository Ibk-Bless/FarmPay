# FarmPay 🌾

[![CI](https://github.com/Ibk-Bless/FarmPay/actions/workflows/ci.yml/badge.svg)](https://github.com/Ibk-Bless/FarmPay/actions/workflows/ci.yml)

**Guaranteed payment for farm deliveries on Stellar.** The buyer's USDC is locked in a Soroban escrow before the farmer delivers. It is released when the buyer confirms delivery, or automatically if the buyer stays silent past the review window.

## The Problem

Smallholder farmers usually deliver first and get paid later — often on 30–90 day terms, sometimes not at all. Once the produce leaves the farm, the farmer has no leverage: payment depends on the buyer's goodwill and cash flow. To cover labour and inputs while they wait, farmers borrow at high rates.

## What FarmPay Does

FarmPay makes every order **pre-funded**. A farmer never delivers against a promise — only against money that is already locked on-chain.

| Without FarmPay | With FarmPay |
|---|---|
| Buyer promises to pay in 30–90 days | Buyer locks the full amount before delivery |
| Farmer can't verify the buyer can pay | Farmer sees the locked funds on-chain before accepting |
| Late or missing payment has no remedy | Funds release automatically if the buyer doesn't respond |
| Quality disagreements stall payment indefinitely | A named arbiter (the farmer's cooperative) settles disputes with a split |

**What FarmPay is not:** it does not lend money or speed up a buyer who has no cash. It removes *payment risk* and caps the wait at a fixed review window (e.g. 72 hours) after delivery.

## The Flow (v1)

v1 supports exactly one flow: **a buyer purchasing from a farmer who belongs to a cooperative, paid in USDC on Stellar.**

```
Funded ──accept──▶ Accepted ──deliver──▶ Delivered ──confirm / window expires──▶ Released
  │                   │                     │
  │ cancel            │ cancel (late)       └──dispute──▶ Disputed ──cooperative splits──▶ Resolved
  ▼                   ▼
Refunded           Refunded
```

1. **Buyer creates an order.** They name the farmer, the cooperative acting as arbiter, the USDC amount, a delivery deadline and a review window. The USDC moves into the contract.
2. **Farmer accepts.** Until then, the buyer can cancel for a full refund.
3. **Farmer marks the order delivered.** The review window starts.
4. **The buyer confirms delivery and the farmer is paid.** If the buyer does nothing before the window ends, anyone can trigger the release to the farmer.
5. **The buyer can open a dispute within the window instead.** The cooperative then decides the split, from 0–100% to the farmer, with the rest refunded to the buyer.
6. **If the farmer accepts but misses the delivery deadline,** the buyer can cancel for a full refund.

Every order and its outcome is recorded on-chain, which gives each farmer a verifiable delivery history.

The full contract specification is in [contracts/escrow/README.md](contracts/escrow/README.md).

## Why Stellar

- **Soroban escrow:** the rules are enforced by a contract, not by FarmPay. FarmPay never holds funds.
- **Native USDC:** farmers are paid in a stable dollar asset, not a volatile token.
- **Low fees:** transactions cost a fraction of a cent, so small orders are viable.
- **Anchors (SEP-24):** a standard way to connect USDC payouts to local bank or mobile-money accounts. This is planned, not in v1.

## Scope

**In v1**
- Soroban escrow contract implementing the flow above
- Buyer and farmer web app: create, accept, deliver, confirm, dispute
- Cooperative view for resolving disputes
- Farmer delivery history page built from on-chain events
- Stellar testnet only

**Not in v1** (see [Roadmap](#roadmap))
- Fiat on/off-ramps (anchors, mobile money)
- Payments in any asset other than USDC
- Credit scoring or lending built on delivery history
- Automated delivery verification (IoT, oracles)

## Known Limitations

We list these openly because they shape what we build next:

- **Buyers have to pre-fund the order.** That's a real cost for the buyer. FarmPay is aimed first at buyers who already pay cash on delivery, such as aggregators and processors buying through cooperatives. It isn't yet aimed at buyers who rely on supplier credit.
- **The arbiter is trusted.** A dishonest cooperative could rule unfairly. The arbiter's address is fixed when the order is created, so both parties agree to it up front.
- **Farmers need a Stellar wallet.** In v1 we assume the cooperative helps members set one up. Mobile-money cash-out comes with anchor integration.

## Tech Stack

| Layer | Technology |
|---|---|
| Smart contract | Rust, Soroban SDK |
| Payments | USDC on Stellar (testnet) |
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Backend | Node.js, Express, TypeScript, Stellar SDK |

## Project Structure

```
farmpay/
├── contracts/escrow/   # Soroban escrow contract + tests
├── backend/            # Keyless API: builds, reads and relays contract calls
├── frontend/           # React web app
├── docs/               # Architecture, API, deployment
└── setup.sh            # One-command testnet setup
```

## Getting Started

### Prerequisites

- Node.js 22+
- Rust with the `wasm32v1-none` target
- [Stellar CLI](https://developers.stellar.org/docs/tools/cli)

### Setup

```bash
git clone https://github.com/Ibk-Bless/FarmPay.git
cd FarmPay
./setup.sh
```

`setup.sh` installs dependencies, runs the contract tests, and deploys the escrow contract to testnet with a test USDC token. It creates funded buyer, farmer and cooperative test accounts, and writes `backend/.env`.

```bash
cd backend && npm run dev     # API on :4000
cd frontend && npm run dev    # app on :3000
```

Open http://localhost:3000, connect [Freighter](https://www.freighter.app/) on Testnet, and create an order. [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md#try-it-in-the-browser) shows how to load the test accounts into Freighter.

## Roadmap

**v1: Testnet MVP (current)**
- [x] Escrow contract: create, accept, deliver, confirm, auto-release, dispute, resolve, cancel
- [x] Contract test suite
- [x] Keyless backend API covering every contract action
- [x] One-command testnet setup with test USDC
- [x] CI for contract, backend and frontend
- [x] Wallet connection (Freighter)
- [x] Create order screen
- [x] Order screen with every role's actions: accept, deliver, confirm, dispute, claim, cancel, resolve
- [ ] Order listing and farmer delivery history (event indexer)
- [ ] Buyer and farmer dashboards (needs the indexer)

**v2: Real-world pilot**
- [ ] SEP-24 anchor integration for local-currency cash-out
- [ ] SMS notifications for farmers
- [ ] Pilot with one cooperative

**Later (research)**
- [ ] Delivery history as an input for input-loan providers
- [ ] Partial deliveries and multi-farmer orders

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and look for issues labelled `good first issue`.

## License

MIT
