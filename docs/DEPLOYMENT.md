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

The constructor takes the escrow token. `create_order` gained a `dispute_window` argument on 30 October 2026, so a contract deployed before that is not compatible with this backend or frontend: redeploy (`./setup.sh` does it) and point `ESCROW_CONTRACT_ID` at the new one. Orders on an old deployment can still be completed there. The contract has no admin and no upgrade path, so a new version means a new deployment. Orders on an older deployment can still be completed there.

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

### Hosting the interactive demo

The demo needs no backend. It is a static site that uses hash routes, so it works on any static host without rewrite rules. For a project page on GitHub Pages (served under `/FarmPay/`):

```bash
cd frontend
VITE_BASE=/FarmPay/ npm run build:demo     # output in frontend/dist/
```

#### Publishing it automatically on GitHub Pages

`.github/workflows/pages.yml` builds the demo and publishes it to `https://<owner>.github.io/<repository>/` on every push to `main`. **It does nothing until you opt in**, so it never fails or publishes by accident:

1. **Settings → Pages → Build and deployment → Source:** choose **GitHub Actions**
2. **Settings → Secrets and variables → Actions → Variables:** add `DEPLOY_DEMO` with the value `true`
3. Push to `main`, or run the **Publish demo** workflow from the Actions tab

To stop publishing, delete the `DEPLOY_DEMO` variable (the site stays up until you unpublish it under Settings → Pages).

What the workflow can do: the build job only reads the repository. Only the deploy job has write access, and only to Pages (`pages: write`, plus `id-token: write`, which Pages uses to prove the deployment came from this repository). Both actions it uses are pinned to full commit hashes. The published site contains only the simulated demo: there is no backend, no wallet and no key in it.

The `pages` test project (`frontend/e2e-pages`) builds the demo exactly as the workflow does and serves it under `/<repository>/`, so a broken asset path fails CI instead of publishing a blank page.

**Order matters (real app).** Single-page apps usually need a catch-all rule that serves `index.html` for unknown paths. Put the `/api` rule *before* that catch-all, or `/api/*` will return the app's HTML instead of JSON. The app handles this without crashing, showing "The FarmPay server sent an unexpected response", but nothing will work until the rule order is fixed. You can check with:

```bash
curl -s https://your-site.example/api/health   # should print {"status":"ok",...}, not HTML
```
