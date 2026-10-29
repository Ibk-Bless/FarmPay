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

## Supply chain and contributions

Open-source projects are targeted with malicious pull requests and poisoned dependencies, so FarmPay treats both as part of its security model.

**How contributions are reviewed**
- Every change is read in full by the maintainer before it merges. Passing CI is necessary, not sufficient.
- Changes to CI workflows, dependencies (`package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`), `setup.sh` and `backend/scripts/` get extra scrutiny, because those run code on CI and on contributors' machines. A pull request should not touch them unless its issue asks for it, and it must explain why. These paths have required code owners (see `.github/CODEOWNERS`).
- Workflows from first-time contributors' forks don't run until the maintainer approves them.

**How the repository protects itself**
- CI jobs run with a read-only token (`permissions: contents: read`).
- Third-party GitHub Actions are pinned to full commit hashes, not movable tags.
- Dependencies install in CI with `--ignore-scripts`, so a compromised package can't run code at install time.
- `npm audit` (high severity and above) and `cargo audit` run on every pull request. Exceptions are listed with reasons in `contracts/escrow/.cargo/audit.toml`.
- Dependabot proposes updates weekly. They are reviewed like any other pull request and never merge automatically.
- The backend never holds user keys, and it only relays a single call to the escrow contract; both are checked in CI.

**Running the project safely**
Before running `./setup.sh` or any script from a pull request, read it. The test accounts it creates are throwaway testnet accounts: never import a real wallet or reuse a real secret key with FarmPay.
