# FarmPay Escrow Contract

Soroban contract that holds a buyer's USDC for a farm order. It pays the farmer when delivery is confirmed or the review window expires, and lets a named arbiter split the funds if there is a dispute.

## Roles

| Role | Who | Can do |
|---|---|---|
| Buyer | Purchaser of the produce | create, cancel, confirm, dispute |
| Farmer | Seller | accept, mark delivered, claim after window |
| Arbiter | The farmer's cooperative, fixed at order creation | resolve disputes |

The contract has no admin and cannot move funds on its own. Every transfer is triggered by one of the roles above, or by anyone once a deadline has passed.

## State Machine

```
Funded    ── accept_order ─────────────────────────────▶ Accepted
Funded    ── cancel_order ─────────────────────────────▶ Refunded
Accepted  ── cancel_order (after delivery_deadline) ───▶ Refunded
Accepted  ── mark_delivered ───────────────────────────▶ Delivered
Delivered ── confirm_delivery ─────────────────────────▶ Released
Delivered ── claim_payment (after review_deadline) ────▶ Released
Delivered ── open_dispute (before review_deadline) ────▶ Disputed
Disputed  ── resolve_dispute ──────────────────────────▶ Resolved
```

Terminal states: `Released`, `Refunded`, `Resolved`.

## Data

```rust
pub enum OrderStatus { Funded, Accepted, Delivered, Disputed, Released, Refunded, Resolved }

pub struct Order {
    pub id: u64,
    pub buyer: Address,
    pub farmer: Address,
    pub arbiter: Address,
    pub amount: i128,              // USDC, 7 decimals
    pub delivery_deadline: u64,    // ledger timestamp
    pub review_window: u64,        // seconds
    pub review_deadline: u64,      // set by mark_delivered; 0 before that
    pub status: OrderStatus,
}
```

The contract is deployed with a single token address (USDC) set in the constructor. Orders are kept in persistent storage, and their TTL is extended on every write.

## Methods

| Method | Auth | Allowed from | Effect |
|---|---|---|---|
| `__constructor(token)` | — | — | Stores the USDC token address |
| `create_order(buyer, farmer, arbiter, amount, delivery_deadline, review_window) -> u64` | buyer | — | Transfers `amount` from buyer to contract, status `Funded`, returns order id |
| `accept_order(id)` | farmer | `Funded` | `Accepted` |
| `cancel_order(id)` | buyer | `Funded`, or `Accepted` after `delivery_deadline` | Full refund to buyer, `Refunded` |
| `mark_delivered(id)` | farmer | `Accepted` | `Delivered`; `review_deadline = now + review_window` |
| `confirm_delivery(id)` | buyer | `Delivered` | Pays farmer, `Released` |
| `claim_payment(id)` | none | `Delivered` after `review_deadline` | Pays farmer, `Released` |
| `open_dispute(id, reason: String)` | buyer | `Delivered` before `review_deadline` | `Disputed` |
| `resolve_dispute(id, farmer_amount)` | arbiter | `Disputed` | Pays `farmer_amount` to farmer and the rest to the buyer, then `Resolved` |
| `get_order(id) -> Order` | — | any | Read-only |
| `token() -> Address` | — | any | Read-only: the escrow token |

### Validation rules
- `amount > 0`. Buyer, farmer and arbiter must be three distinct addresses.
- `delivery_deadline` must be in the future at creation.
- `0 <= farmer_amount <= amount`.
- Calls made from the wrong state fail with a typed `Error`. Calls without the right signature fail authorization. In both cases the state does not change.

### Errors

| Code | Error | Meaning |
|---|---|---|
| 1 | `OrderNotFound` | No order with this id |
| 2 | `InvalidAmount` | `amount <= 0` |
| 3 | `InvalidParties` | Buyer, farmer and arbiter are not distinct |
| 4 | `InvalidDeadline` | Delivery deadline is not in the future, or the review window is 0 |
| 5 | `InvalidStatus` | Action not allowed in the order's current status |
| 6 | `TooEarly` | Deadline hasn't passed yet (cancel or claim) |
| 7 | `TooLate` | Review window has closed (dispute) |
| 8 | `InvalidSplit` | `farmer_amount` outside `0..=amount` |

### Events

| Event | Topics | Data |
|---|---|---|
| `status_changed` | order id | new `OrderStatus` |
| `dispute_opened` | order id | `reason` |

The backend indexes these events to build farmer delivery histories.

## Building

Requires the [Stellar CLI](https://developers.stellar.org/docs/tools/cli).

```bash
stellar contract build
```

## Testing

```bash
cargo test
```

The tests in `src/test.rs` cover the happy path, auto-release, both cancellation paths, dispute splits (including bounds), window timing, invalid transitions and authorization.

## Deployment (testnet)

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/farmpay_escrow.wasm \
  --source admin \
  --network testnet \
  -- --token <USDC_CONTRACT_ID>
```
