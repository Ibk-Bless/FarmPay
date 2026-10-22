# Deployment

FarmPay currently targets **Stellar testnet** only. Mainnet deployment needs an audit and a real USDC issuer, and it's out of scope until both are done.

## Contract

```bash
cd contracts/escrow
stellar contract build
stellar contract deploy \
  --wasm target/wasm32v1-none/release/farmpay_escrow.wasm \
  --source <deployer-identity> \
  --network testnet \
  -- --token <USDC_TOKEN_CONTRACT_ID>
```

The constructor takes the escrow token. The contract has no admin and no upgrade path, so a new version means a new deployment. Orders on an older deployment can still be completed there.

To get the token contract ID for a classic Stellar asset:

```bash
stellar contract id asset --asset USDC:<ISSUER> --network testnet
```

For local development, `./setup.sh` issues a test USDC asset and deploys against it. See [GETTING_STARTED.md](GETTING_STARTED.md).

## Backend

```bash
cd backend
npm ci
npm run build
npm start
```

Environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `STELLAR_NETWORK_PASSPHRASE` | testnet passphrase | Network the transactions are built for |
| `ESCROW_CONTRACT_ID` | — | Deployed escrow contract (required for order endpoints) |
| `CORS_ORIGIN` | — (any origin) | Comma-separated browser origins allowed to call the API, e.g. `https://farmpay.example`. **Set this when deploying.** The server warns at startup if it is empty |
| `LOG_REQUESTS` | `true` | One JSON log line per request; `false` silences it |

### Logs and request ids

Every response carries an `X-Request-Id` header, and each request writes one JSON line when it finishes:

```json
{"time":"2026-10-20T07:16:26.575Z","requestId":"7c36a0fc-…","method":"POST","path":"/api/orders/1/accept","status":409,"ms":812.4}
```

Ask users to quote the `X-Request-Id` from a failed request, and search the logs for it. Request bodies and query strings are never logged, and `/api/health` is skipped so health checks don't flood the log. Unexpected `500` errors are logged with the same id.

CORS only controls which websites a *browser* will let read the API's responses; it doesn't stop other clients such as `curl`. Rate limiting is tracked separately in [#12](https://github.com/Ibk-Bless/FarmPay/issues/12).

On `SIGTERM` or `SIGINT` the server stops accepting connections and finishes in-flight requests (up to 10 seconds) before exiting, so a deploy does not cut a transaction off mid-submit.

The backend holds no secret keys. It builds unsigned transactions and relays signed ones. It only accepts transactions that make a single call to `ESCROW_CONTRACT_ID`.

## Frontend

```bash
cd frontend
npm ci
npm run build
```

Serve `frontend/dist/` from any static host. Route `/api` to the backend, either through a reverse proxy or your host's rewrite rules.

**Order matters.** Single-page apps usually need a catch-all rule that serves `index.html` for unknown paths. Put the `/api` rule *before* that catch-all, or `/api/*` will return the app's HTML instead of JSON. The app handles this without crashing, showing "The FarmPay server sent an unexpected response", but nothing will work until the rule order is fixed. You can check with:

```bash
curl -s https://your-site.example/api/health   # should print {"status":"ok",...}, not HTML
```
