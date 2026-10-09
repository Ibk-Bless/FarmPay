# Security Policy

FarmPay's escrow contract holds user funds, so we take vulnerability reports seriously.

## Scope

- The escrow contract in `contracts/escrow` — anything that lets funds move outside the rules in its [specification](contracts/escrow/README.md), lets the wrong party act on an order, or locks funds permanently
- The backend in `backend` — e.g. relaying transactions it shouldn't, or leaking data
- The web app in `frontend` — e.g. tricking a user into signing a different transaction than the one shown

FarmPay currently runs on **Stellar testnet only**; no real funds are at risk yet. Reports are still very welcome, because the same code is what a mainnet deployment would use.

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private reporting instead:

1. Go to the repository's **Security** tab
2. Click **Report a vulnerability**
3. Describe the issue, how to reproduce it, and the impact

You'll get an acknowledgement within 3 days. Once a fix is ready we'll credit you in the release notes, unless you prefer to stay anonymous.
