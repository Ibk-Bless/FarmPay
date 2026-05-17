# Getting Started with FarmPay

This guide will help you set up FarmPay locally for development.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** 18 or higher ([Download](https://nodejs.org/))
- **Rust** and Cargo ([Install](https://rustup.rs/))
- **PostgreSQL** 14 or higher ([Download](https://www.postgresql.org/download/))
- **Git** ([Download](https://git-scm.com/downloads))

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd farmpay
```

### 2. Install Soroban CLI

```bash
cargo install --locked soroban-cli
```

### 3. Set Up Stellar Testnet

```bash
# Add testnet network
soroban network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"

# Generate admin identity
soroban keys generate admin --network testnet

# Fund the account with testnet XLM
# Visit: https://laboratory.stellar.org/#account-creator?network=test
# Or use: soroban keys address admin | xargs -I {} curl "https://friendbot.stellar.org?addr={}"
```

### 4. Set Up Database

```bash
# Create database
createdb farmpay

# Or using psql
psql -U postgres -c "CREATE DATABASE farmpay;"
```

### 5. Build and Deploy Escrow Contract

```bash
cd contracts/escrow

# Build the contract
cargo build --target wasm32-unknown-unknown --release

# Deploy to testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/farmpay_escrow.wasm \
  --source admin \
  --network testnet

# Save the contract ID that's returned
```

### 6. Set Up Backend

```bash
cd ../../backend

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env and add:
# - Your PostgreSQL connection string
# - The contract ID from step 5
# - Admin secret key from step 3
nano .env

# Start development server
npm run dev
```

The backend should now be running on `http://localhost:4000`

### 7. Set Up Frontend

```bash
cd ../frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

The frontend should now be running on `http://localhost:3000`

## Verify Installation

### Test Backend

```bash
curl http://localhost:4000/api/health
```

Expected response:
```json
{
  "status": "ok",
  "message": "FarmPay API is running"
}
```

### Test Frontend

Open your browser and navigate to `http://localhost:3000`. You should see the FarmPay landing page.

## Development Workflow

### Making Changes to the Contract

```bash
cd contracts/escrow

# Make your changes to src/lib.rs

# Rebuild
cargo build --target wasm32-unknown-unknown --release

# Redeploy
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/farmpay_escrow.wasm \
  --source admin \
  --network testnet

# Update the contract ID in backend/.env
```

### Making Changes to the Backend

The backend uses `tsx watch` which automatically restarts on file changes. Just edit files in `backend/src/` and save.

### Making Changes to the Frontend

The frontend uses Vite's hot module replacement. Changes will appear instantly in your browser.

## Project Structure

```
farmpay/
├── contracts/escrow/       # Soroban smart contract
│   ├── src/lib.rs         # Contract implementation
│   └── Cargo.toml         # Rust dependencies
├── backend/               # Node.js API server
│   ├── src/
│   │   ├── index.ts      # Server entry point
│   │   └── stellar/      # Stellar integration
│   └── package.json
├── frontend/              # React web app
│   ├── src/
│   │   ├── pages/        # Page components
│   │   ├── App.tsx       # Main app component
│   │   └── main.tsx      # Entry point
│   └── package.json
└── docs/                  # Documentation
```

## Common Issues

### Contract Deployment Fails

**Error:** "Account not found"
- **Solution:** Fund your admin account with testnet XLM using Friendbot

**Error:** "Insufficient balance"
- **Solution:** Request more testnet XLM from Friendbot

### Backend Won't Start

**Error:** "Cannot connect to database"
- **Solution:** Ensure PostgreSQL is running and connection string is correct

**Error:** "Contract ID not found"
- **Solution:** Deploy the contract and update `ESCROW_CONTRACT_ID` in `.env`

### Frontend Build Errors

**Error:** "Module not found"
- **Solution:** Run `npm install` in the frontend directory

**Error:** "Cannot connect to backend"
- **Solution:** Ensure backend is running on port 4000

## Next Steps

Now that you have FarmPay running locally:

1. **Explore the Landing Page** - Navigate to `http://localhost:3000`
2. **Review the Architecture** - Read `docs/ARCHITECTURE.md`
3. **Implement Features** - Check the roadmap in `README.md`
4. **Write Tests** - Add tests for contract and API endpoints
5. **Deploy to Testnet** - Follow `docs/DEPLOYMENT.md`

## Getting Help

- **Documentation**: Check the `docs/` folder
- **Issues**: Open an issue on GitHub
- **Stellar Docs**: https://developers.stellar.org/
- **Soroban Docs**: https://soroban.stellar.org/docs

## Useful Commands

```bash
# Backend
cd backend
npm run dev          # Start development server
npm run build        # Build for production
npm start            # Run production build

# Frontend
cd frontend
npm run dev          # Start development server
npm run build        # Build for production
npm run preview      # Preview production build

# Contract
cd contracts/escrow
cargo build --target wasm32-unknown-unknown --release  # Build
cargo test                                              # Run tests
soroban contract invoke --id <ID> -- <method>         # Call method
```

Happy coding! 🌾
