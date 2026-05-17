# FarmPay Escrow Contract

Soroban smart contract for handling escrow payments between buyers and farmers.

## Features

- **Lock Payment**: Buyer locks payment in escrow when creating order
- **Release Payment**: Buyer confirms delivery, payment released to farmer
- **Dispute Handling**: Buyer can raise dispute within window
- **Auto-Release**: Payment automatically releases after dispute window expires

## Building

```bash
cargo build --target wasm32-unknown-unknown --release
```

## Testing

```bash
cargo test
```

## Deployment

```bash
# Deploy to testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/farmpay_escrow.wasm \
  --source <ADMIN_SECRET_KEY> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

## Contract Methods

### `lock_payment`
Locks payment in escrow for an order.

**Parameters:**
- `order_id`: Unique order identifier
- `buyer`: Buyer's Stellar address
- `farmer`: Farmer's Stellar address
- `amount`: Payment amount in stroops
- `dispute_window_days`: Number of days for dispute window

### `release_payment`
Releases payment to farmer after delivery confirmation.

**Parameters:**
- `order_id`: Order identifier
- `buyer`: Buyer's address (must match escrow)

### `initiate_dispute`
Buyer raises a dispute about delivery.

**Parameters:**
- `order_id`: Order identifier
- `buyer`: Buyer's address
- `reason`: Dispute reason

### `get_escrow`
Retrieves escrow details for an order.

**Parameters:**
- `order_id`: Order identifier

### `auto_release`
Automatically releases payment after dispute window expires.

**Parameters:**
- `order_id`: Order identifier
