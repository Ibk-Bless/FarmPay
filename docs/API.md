# FarmPay API

Base URL: `http://localhost:4000/api` (development)

## Signing model

The API never holds user keys. Every write follows the same two steps:

1. **Build:** call an action endpoint. It returns an unsigned, simulated transaction (`xdr`) for the right party to sign.
2. **Submit:** the user signs the transaction in their wallet, and the client posts it to `POST /transactions`.

The order id is the id assigned by the escrow contract. Amounts are decimal strings in USDC, with up to 7 decimal places.

## Endpoints

### Health

**GET** `/health`

```json
{ "status": "ok", "escrowContractId": "CCD4..." }
```

### Create order

**POST** `/orders`. Signed by the **buyer**.

```json
{
  "buyer": "GBKX...",
  "farmer": "GBJV...",
  "arbiter": "GBPD...",
  "amount": "1840.50",
  "deliveryDeadline": "2026-10-14T00:00:00Z",
  "reviewWindowHours": 72
}
```

Response:

```json
{ "action": "create", "xdr": "AAAAAgAAAAB..." }
```

After submitting, the response from `POST /transactions` includes the new `orderId`.

### Get order

**GET** `/orders/:orderId`

Reads the order directly from the contract.

```json
{
  "id": "1",
  "buyer": "GBKX...",
  "farmer": "GBJV...",
  "arbiter": "GBPD...",
  "amount": "1840.5",
  "deliveryDeadline": 1792195200,
  "reviewWindow": 259200,
  "reviewDeadline": 1791628672,
  "status": "Delivered"
}
```

Timestamps are Unix seconds (ledger time). `reviewDeadline` is `0` until the farmer marks the order delivered.

`status` is one of `Funded`, `Accepted`, `Delivered`, `Disputed`, `Released`, `Refunded` or `Resolved`.

### Order actions

**POST** `/orders/:orderId/:action`

Each action maps to one contract method. The signer comes from the order, so the client doesn't choose it.

| Action | Signer | Contract method | Allowed when | Body |
|---|---|---|---|---|
| `accept` | farmer | `accept_order` | `Funded` | — |
| `cancel` | buyer | `cancel_order` | `Funded`, or `Accepted` after the delivery deadline | — |
| `deliver` | farmer | `mark_delivered` | `Accepted` | — |
| `confirm` | buyer | `confirm_delivery` | `Delivered` | — |
| `claim` | farmer, or `caller` | `claim_payment` | `Delivered`, after the review deadline | `{ "caller": "G..." }` (optional) |
| `dispute` | buyer | `open_dispute` | `Delivered`, before the review deadline | `{ "reason": "Short by 200kg" }` |
| `resolve` | arbiter | `resolve_dispute` | `Disputed` | `{ "farmerAmount": "800" }` |

Response:

```json
{ "orderId": "1", "action": "confirm", "xdr": "AAAAAgAAAAB..." }
```

Each action is simulated against the contract before the transaction is returned. An action that isn't allowed in the current state fails at this point with an error, and the user never signs anything.

### Submit signed transaction

**POST** `/transactions`

```json
{ "signedXdr": "AAAAAgAAAAB..." }
```

Response:

```json
{ "hash": "06ee39b6...", "orderId": "1" }
```

`orderId` is only present for `create_order`. The API only relays transactions that make a single call to the configured escrow contract.

## Errors

```json
{ "error": { "code": "TOO_EARLY", "message": "..." } }
```

| HTTP | Code | Cause |
|---|---|---|
| 400 | `MISSING_FIELD`, `INVALID_ADDRESS`, `INVALID_AMOUNT`, `INVALID_DEADLINE`, `INVALID_ORDER_ID`, `INVALID_PARTIES`, `INVALID_SPLIT`, `INVALID_TRANSACTION` | Bad input |
| 403 | `UNAUTHORIZED` | The signer isn't allowed to perform this action |
| 404 | `ORDER_NOT_FOUND`, `ACCOUNT_NOT_FOUND`, `NOT_FOUND` | Unknown order, unfunded account or unknown action |
| 409 | `INVALID_STATUS`, `TOO_EARLY`, `TOO_LATE` | Action not allowed in the order's current state or at the current time |
| 502 | `SIMULATION_FAILED`, `SUBMIT_FAILED`, `TRANSACTION_FAILED` | Network or RPC failure |

Contract error codes map one-to-one to the contract's `Error` enum. See [contracts/escrow/README.md](../contracts/escrow/README.md#errors).

## Planned

- `GET /orders?party=<address>`: list a party's orders, indexed from contract events
- `GET /farmers/:address/history`: delivery history built from `Released` and `Resolved` orders
- Off-chain order details (crop, quantity, notes) stored alongside the on-chain order
