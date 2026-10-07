# Getting Started

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
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

## Try the flow

The API returns unsigned transactions. In the app they will be signed by the user's wallet. From the command line, you can sign them with the Stellar CLI identities that `setup.sh` created:

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
│   ├── pages/              # route components
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
