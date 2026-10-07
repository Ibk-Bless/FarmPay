#!/bin/bash
# FarmPay local setup: installs dependencies, deploys the escrow contract to
# Stellar testnet with a test USDC token, and writes backend/.env.
#
# Creates funded testnet identities: fp-deployer, fp-issuer, fp-buyer, fp-farmer, fp-coop.
# The buyer receives 5,000 test USDC. Safe to re-run.

set -euo pipefail
cd "$(dirname "$0")"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'
ok() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }

echo "🌾 FarmPay setup"
echo

command -v node >/dev/null || fail "Node.js 22+ is required: https://nodejs.org/"
command -v cargo >/dev/null || fail "Rust is required: https://rustup.rs/"
command -v stellar >/dev/null || fail "Stellar CLI is required: https://developers.stellar.org/docs/tools/cli"
rustup target list --installed | grep -q wasm32v1-none || rustup target add wasm32v1-none
ok "Prerequisites found"

(cd frontend && npm install --no-audit --no-fund >/dev/null)
(cd backend && npm install --no-audit --no-fund >/dev/null)
ok "npm dependencies installed"

(cd contracts/escrow && cargo test --quiet >/dev/null && stellar contract build >/dev/null 2>&1)
ok "Contract tests pass and WASM built"

for key in fp-deployer fp-issuer fp-buyer fp-farmer fp-coop; do
  stellar keys address "$key" >/dev/null 2>&1 || stellar keys generate "$key" --network testnet --fund >/dev/null
done
ok "Testnet identities ready (stellar keys ls)"

ASSET="USDC:$(stellar keys address fp-issuer)"
for key in fp-buyer fp-farmer fp-coop; do
  stellar tx new change-trust --source "$key" --line "$ASSET" --network testnet >/dev/null 2>&1
done
stellar tx new payment --source fp-issuer --destination "$(stellar keys address fp-buyer)" \
  --asset "$ASSET" --amount 50000000000 --network testnet >/dev/null
TOKEN=$(stellar contract asset deploy --asset "$ASSET" --source fp-deployer --network testnet 2>/dev/null \
  || stellar contract id asset --asset "$ASSET" --network testnet)
ok "Test USDC token: $TOKEN (buyer funded with 5,000 USDC)"

ESCROW=$(stellar contract deploy \
  --wasm contracts/escrow/target/wasm32v1-none/release/farmpay_escrow.wasm \
  --source fp-deployer --network testnet -- --token "$TOKEN" 2>/dev/null)
ok "Escrow contract: $ESCROW"

[ -f backend/.env ] || cp backend/.env.example backend/.env
sed -i.bak "s/^ESCROW_CONTRACT_ID=.*/ESCROW_CONTRACT_ID=$ESCROW/" backend/.env && rm backend/.env.bak
ok "backend/.env updated"

echo
echo "Next:"
echo "  cd backend && npm run dev      # API on http://localhost:4000"
echo "  cd frontend && npm run dev     # app on http://localhost:3000"
echo
echo "Try it in the browser: docs/GETTING_STARTED.md#try-it-in-the-browser"
