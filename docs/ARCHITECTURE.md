# Architecture

FarmPay is a Soroban escrow on Stellar that guarantees payment for farm deliveries. The buyer pre-funds each order in USDC. Funds go to the farmer on confirmation or after a review window, and the farmer's cooperative arbitrates disputes.

## Components

```
┌──────────────────────┐   unsigned tx (xdr)   ┌──────────────────────┐
│  Frontend (React)    │ ◀──────────────────── │  Backend (Express)   │
│  + user's wallet     │ ── signed tx ───────▶ │  routes/orders.ts    │
│    signs every write │                       │  stellar/escrow.ts   │
└──────────────────────┘                       └──────────┬───────────┘
                                                          │ Soroban RPC
                                                          ▼
                                   ┌─────────────────────────────────────┐
                                   │  Stellar                            │
                                   │  ┌───────────────┐  ┌────────────┐  │
                                   │  │ FarmPay escrow│─▶│ USDC token │  │
                                   │  │ contract      │  │ (SAC)      │  │
                                   │  └───────────────┘  └────────────┘  │
                                   └─────────────────────────────────────┘
```

### Escrow contract (`contracts/escrow`)
The source of truth for every order. It holds the USDC, enforces the state machine and decides who may act and when. It has no admin key, so neither FarmPay nor anyone else can move funds outside the rules. Full specification: [contracts/escrow/README.md](../contracts/escrow/README.md).

### Backend (`backend`)
A thin, keyless layer between the app and the network:
- **Builds** each action as a simulated, unsigned transaction. Simulation catches invalid actions before the user signs anything.
- **Reads** orders straight from the contract.
- **Relays** signed transactions, but only single calls to the configured escrow contract. It then waits for the result.

### Frontend (`frontend`)
React app for the three roles: buyer, farmer and cooperative. It shows order state and sends each action to the user's wallet for signing.

## Order lifecycle

```
Funded ──accept──▶ Accepted ──deliver──▶ Delivered ──confirm / claim──▶ Released
  │                   │                     │
  │ cancel            │ cancel (late)       └──dispute──▶ Disputed ──resolve──▶ Resolved
  ▼                   ▼
Refunded           Refunded
```

| Step | Who signs | What moves |
|---|---|---|
| Create | Buyer | USDC from the buyer to the contract |
| Accept | Farmer | — |
| Mark delivered | Farmer | — (the review window starts) |
| Confirm | Buyer | USDC from the contract to the farmer |
| Claim (after window) | Anyone | USDC from the contract to the farmer |
| Dispute | Buyer | — |
| Resolve | Cooperative | Split between the farmer and the buyer |
| Cancel | Buyer | USDC from the contract back to the buyer |

## Trust model

| Party | Can | Cannot |
|---|---|---|
| Buyer | Confirm, dispute within the window, cancel before acceptance or after a missed deadline | Take funds back once the farmer has delivered |
| Farmer | Accept, mark delivered, claim after the window | Get paid without delivering (the buyer can dispute) |
| Cooperative | Split the funds of a **disputed** order | Touch undisputed orders, or pay out more than the order amount |
| FarmPay | Build and relay transactions | Sign for anyone, or move any funds |

The main trust assumption is the cooperative's judgement in disputes. Both parties see the arbiter's address before any money moves.

## Design decisions

- **The review window starts at delivery, not at creation.** Otherwise auto-release could pay out before anything has been delivered.
- **Disputes end in a split, not a winner-takes-all ruling.** Partial deliveries are the most common real dispute.
- **One token per deployment.** The contract is deployed with USDC as its token, so it never has to choose or whitelist assets.
- **There is no database yet.** Everything v1 needs is on-chain. A database will hold off-chain order details (crop, quantity, notes) and an event index for listing orders.
