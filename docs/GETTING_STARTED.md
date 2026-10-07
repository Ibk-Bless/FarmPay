# Getting Started

## Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) with the `wasm32v1-none` target (`rustup target add wasm32v1-none`)
- [Stellar CLI](https://developers.stellar.org/docs/tools/cli)

## One-command setup

```bash
git clone https://github.com/Ibk-Bless/FarmPay.git
cd FarmPay
./setup.sh
```

`setup.sh` does the following:
1. Installs the npm dependencies for `frontend/` and `backend/`
2. Runs the contract tests and builds the WASM
3. Creates funded testnet identities: `fp-deployer`, `fp-issuer`, `fp-buyer`, `fp-farmer` and `fp-coop`
4. Issues a **test USDC** asset and gives the buyer 5,000 of it
5. Deploys the escrow contract with that token
6. Writes the contract ID to `backend/.env`

Then start the app:

```bash
cd backend && npm run dev     # API on http://localhost:4000
cd frontend && npm run dev    # app on http://localhost:3000
```

Check the API:

```bash
curl http://localhost:4000/api/health
# {"status":"ok","escrowContractId":"C..."}
```

## Try it in the browser

1. Install the [Freighter](https://www.freighter.app/) extension and switch it to **Testnet**.
2. Import the test accounts that `setup.sh` created. Print each secret key with:
   ```bash
   stellar keys secret fp-buyer    # also fp-farmer and fp-coop
   ```
   In Freighter, choose **Import a Stellar secret key** for each one. These are throwaway testnet keys. Never do this with a real account.
3. Open http://localhost:3000 and connect Freighter as the buyer.
4. **New order:** paste the farmer and cooperative addresses (`stellar keys address fp-farmer` and `fp-coop`) and sign. You land on the order page.
5. Switch Freighter to the farmer account and reload. Accept, then mark the order delivered.
6. Switch back to the buyer. Confirm delivery, or open a dispute and resolve it as `fp-coop`.

Share the order page link with the other party. Each person only sees the actions their account is allowed to take.

## Try the flow from the command line

The API returns unsigned transactions. You can sign them with the Stellar CLI identities that `setup.sh` created:

```bash
API=http://localhost:4000/api
BUYER=$(stellar keys address fp-buyer)
FARMER=$(stellar keys address fp-farmer)
COOP=$(stellar keys address fp-coop)

# Sign the xdr from a build response with an identity and submit it.
sign_submit() {
  local signed
  signed=$(jq -r .xdr | stellar tx sign --sign-with-key "$1" --network testnet)
  curl -s -X POST $API/transactions -H 'content-type: application/json' -d "{\"signedXdr\":\"$signed\"}"
}

# 1. Buyer creates and funds an order
curl -s -X POST $API/orders -H 'content-type: application/json' -d "{
  \"buyer\":\"$BUYER\", \"farmer\":\"$FARMER\", \"arbiter\":\"$COOP\",
  \"amount\":\"1840.50\", \"deliveryDeadline\":\"$(date -u -d '+7 days' +%FT%TZ)\",
  \"reviewWindowHours\":72 }" | sign_submit fp-buyer
# {"hash":"...","orderId":"1"}

# 2. Farmer accepts, then marks the order delivered
curl -s -X POST $API/orders/1/accept | sign_submit fp-farmer
curl -s -X POST $API/orders/1/deliver | sign_submit fp-farmer

# 3. Buyer confirms, and the farmer is paid
curl -s -X POST $API/orders/1/confirm | sign_submit fp-buyer
curl -s $API/orders/1
# {"id":"1","status":"Released",...}
```

For a dispute, call `/orders/:id/dispute` with `{"reason":"..."}` signed by `fp-buyer`. Then call `/orders/:id/resolve` with `{"farmerAmount":"800"}` signed by `fp-coop`. Every endpoint is listed in [API.md](API.md).

## Development workflow

### Contract

```bash
cd contracts/escrow
cargo test                # unit tests (src/test.rs)
stellar contract build    # WASM in target/wasm32v1-none/release/
```

If you change the contract interface, re-run `./setup.sh` to deploy a fresh contract. It also updates `backend/.env`. Old orders stay on the previous contract.

### Backend

```bash
cd backend
npm run dev     # tsx watch, restarts on change
npm run build   # type-check and compile to dist/
```

### Frontend

```bash
cd frontend
npm run dev     # Vite dev server; /api is proxied to localhost:4000
npm run build   # type-check and production build
```

## Project structure

```
FarmPay/
├── contracts/escrow/
│   ├── src/lib.rs          # escrow contract
│   ├── src/test.rs         # contract tests
│   └── README.md           # contract specification
├── backend/src/
│   ├── index.ts            # Express app
│   ├── config.ts           # environment
│   ├── routes/orders.ts    # REST endpoints
│   └── stellar/escrow.ts   # contract client: build, read, submit
├── frontend/src/
│   ├── pages/              # route components (OrderCreation, OrderDetail, ...)
│   ├── wallet/             # Freighter connection and the sign-and-submit hook
│   ├── lib/api.ts          # typed backend client
│   └── App.tsx             # routes
├── docs/                   # architecture, API, deployment
└── setup.sh                # testnet setup
```

## Common issues

| Symptom | Fix |
|---|---|
| `ACCOUNT_NOT_FOUND` from the API | The signer's account isn't funded on testnet. Run `stellar keys fund <name> --network testnet` |
| `order endpoints are disabled` on startup | `ESCROW_CONTRACT_ID` is empty in `backend/.env`. Run `./setup.sh` |
| Transfer fails with a trustline error | The farmer or buyer has no trustline to the test USDC asset. Re-run `./setup.sh` |
| `rustup target` errors when building | `rustup target add wasm32v1-none` |
| Testnet was reset and the contract is gone | Testnet is wiped periodically. Re-run `./setup.sh` |
