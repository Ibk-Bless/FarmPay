# FarmPay Escrow Contract

Soroban contract that holds a buyer's USDC for a farm order. It pays the farmer when delivery is confirmed or the review window expires, and lets a named arbiter split the funds if there is a dispute. If the arbiter does not rule in time, anyone can settle the dispute with a default 50/50 split, so a missing arbiter can never lock funds.

## Roles

| Role | Who | Can do |
|---|---|---|
| Buyer | Purchaser of the produce | create, cancel, confirm, dispute |
| Farmer | Seller | accept, mark delivered, claim after window |
| Arbiter | The farmer's cooperative, fixed at order creation | resolve disputes (before the dispute deadline) |
| Anyone | Any account | claim payment after the review window, settle an expired dispute |

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
Disputed  ── resolve_dispute (before dispute_deadline) ▶ Resolved
Disputed  ── expire_dispute  (after dispute_deadline) ──▶ Resolved (50/50 split)
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
    pub dispute_window: u64,       // seconds the arbiter has to rule; 1 day to 30 days
    pub dispute_deadline: u64,     // set by open_dispute; 0 before that
    pub status: OrderStatus,
}
```

The contract is deployed with a single token address (USDC) set in the constructor.

### Storage lifetime

Soroban archives storage entries whose time-to-live (TTL) runs out. The contract keeps everything live for as long as it is needed, so no order is archived in the middle of its lifecycle:

| Entry | Kept live until | When it's extended |
|---|---|---|
| Contract instance and code | At least 30 days ahead, topped up to 90 days | Construction and every state change |
| `Funded` / `Accepted` order | Delivery deadline + review window + 14 days | Every write to the order |
| `Delivered` order | Review deadline + 14 days | Every write to the order |
| `Disputed` order | Dispute deadline + 14 days (at least 30 days) | Every write to the order |
| Finished orders | 30 days after the last update | Every write to the order |

Time is converted to ledgers at 5 seconds per ledger, which slightly over-estimates and keeps data live a little longer. Every TTL is capped at the network's maximum entry TTL. An order whose deadlines are further out than that maximum can still expire, but archived entries are not lost: they can be restored with a `RestoreFootprint` operation.

## Methods

| Method | Auth | Allowed from | Effect |
|---|---|---|---|
| `__constructor(token)` | — | — | Stores the USDC token address |
| `create_order(buyer, farmer, arbiter, amount, delivery_deadline, review_window, dispute_window) -> u64` | buyer | — | Transfers `amount` from buyer to contract, status `Funded`, returns order id |
| `accept_order(id)` | farmer | `Funded` | `Accepted` |
| `cancel_order(id)` | buyer | `Funded`, or `Accepted` after `delivery_deadline` | Full refund to buyer, `Refunded` |
| `mark_delivered(id)` | farmer | `Accepted` | `Delivered`; `review_deadline = now + review_window` |
| `confirm_delivery(id)` | buyer | `Delivered` | Pays farmer, `Released` |
| `claim_payment(id)` | none | `Delivered` after `review_deadline` | Pays farmer, `Released` |
| `open_dispute(id, reason: String)` | buyer | `Delivered` before `review_deadline` | `Disputed`; `dispute_deadline = now + dispute_window` |
| `resolve_dispute(id, farmer_amount)` | arbiter | `Disputed`, up to `dispute_deadline` | Pays `farmer_amount` to farmer and the rest to the buyer, then `Resolved` |
| `expire_dispute(id)` | none | `Disputed` after `dispute_deadline` | Pays half to the farmer (rounded down) and the rest to the buyer, then `Resolved` |
| `get_order(id) -> Order` | — | any | Read-only |
| `token() -> Address` | — | any | Read-only: the escrow token |

### Why disputes have a deadline, and why the default is a split

A dispute that only the arbiter can end would lock the funds forever if the arbiter disappeared or lost its key ([#29](https://github.com/Ibk-Bless/FarmPay/issues/29)). So the buyer picks a **dispute window** when creating the order (1 to 30 days), and it starts when the dispute is opened. Until the deadline only the arbiter can rule. After it, the arbiter can no longer rule and **anyone** can call `expire_dispute`, so the outcome cannot change once it is final.

The default is an **even split** because each alternative rewards bad behaviour:
- refunding the buyer would let a dishonest buyer dispute a good delivery, hoping the arbiter stays silent, and keep the goods for free;
- paying the farmer would punish a buyer with a genuine problem.

A split limits either side's loss to half, so both have a reason to make sure the arbiter acts. An odd last unit goes to the buyer (the farmer receives `amount / 2` rounded down), so nothing is ever lost or locked.

### Validation rules
- `amount > 0`. Buyer, farmer and arbiter must be three distinct addresses.
- `delivery_deadline` must be in the future at creation, and `review_window` must be greater than 0.
- `dispute_window` must be between 1 day and 30 days.
- `0 <= farmer_amount <= amount`.
- Calls made from the wrong state fail with a typed `Error`. Calls without the right signature fail authorization. In both cases the state does not change.

### Errors

| Code | Error | Meaning |
|---|---|---|
| 1 | `OrderNotFound` | No order with this id |
| 2 | `InvalidAmount` | `amount <= 0` |
| 3 | `InvalidParties` | Buyer, farmer and arbiter are not distinct |
| 4 | `InvalidDeadline` | Delivery deadline is not in the future, the review window is 0, or the dispute window is outside 1 to 30 days |
| 5 | `InvalidStatus` | Action not allowed in the order's current status |
| 6 | `TooEarly` | Deadline hasn't passed yet (cancel, claim or settling a dispute by default) |
| 7 | `TooLate` | The window has closed (a dispute after the review window, or an arbiter ruling after the dispute deadline) |
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

The tests in `src/test.rs` cover the happy path, auto-release, both cancellation paths, dispute splits (including bounds), window timing, invalid transitions, authorization, storage lifetimes, and the dispute deadline (rulings up to and after the boundary, the default split, odd amounts, and that a ruling and a default settlement are mutually exclusive).

## Deployment (testnet)

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/farmpay_escrow.wasm \
  --source admin \
  --network testnet \
  -- --token <USDC_CONTRACT_ID>
```
