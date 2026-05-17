#!/bin/bash

# FarmPay Setup Script
# This script helps you set up the FarmPay development environment

set -e

echo "🌾 FarmPay Setup Script"
echo "======================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "Checking prerequisites..."
echo ""

# Check Node.js
if command_exists node; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✓${NC} Node.js ${NODE_VERSION} installed"
else
    echo -e "${RED}✗${NC} Node.js not found. Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

# Check npm
if command_exists npm; then
    NPM_VERSION=$(npm --version)
    echo -e "${GREEN}✓${NC} npm ${NPM_VERSION} installed"
else
    echo -e "${RED}✗${NC} npm not found"
    exit 1
fi

# Check Rust
if command_exists cargo; then
    RUST_VERSION=$(rustc --version | cut -d' ' -f2)
    echo -e "${GREEN}✓${NC} Rust ${RUST_VERSION} installed"
else
    echo -e "${YELLOW}!${NC} Rust not found. Install from https://rustup.rs/"
    echo "   Required for Soroban smart contracts"
fi

# Check PostgreSQL
if command_exists psql; then
    PSQL_VERSION=$(psql --version | cut -d' ' -f3)
    echo -e "${GREEN}✓${NC} PostgreSQL ${PSQL_VERSION} installed"
else
    echo -e "${YELLOW}!${NC} PostgreSQL not found. Install from https://www.postgresql.org/"
    echo "   Required for backend database"
fi

# Check Soroban CLI
if command_exists soroban; then
    SOROBAN_VERSION=$(soroban --version | cut -d' ' -f2)
    echo -e "${GREEN}✓${NC} Soroban CLI ${SOROBAN_VERSION} installed"
else
    echo -e "${YELLOW}!${NC} Soroban CLI not found"
    read -p "   Install Soroban CLI now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "   Installing Soroban CLI..."
        cargo install --locked soroban-cli
        echo -e "${GREEN}✓${NC} Soroban CLI installed"
    fi
fi

echo ""
echo "Installing dependencies..."
echo ""

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd frontend
npm install
cd ..
echo -e "${GREEN}✓${NC} Frontend dependencies installed"

# Install backend dependencies
echo "📦 Installing backend dependencies..."
cd backend
npm install
cd ..
echo -e "${GREEN}✓${NC} Backend dependencies installed"

echo ""
echo "Setting up Stellar testnet..."
echo ""

# Check if testnet network exists
if soroban network ls 2>/dev/null | grep -q "testnet"; then
    echo -e "${GREEN}✓${NC} Testnet network already configured"
else
    echo "Adding testnet network..."
    soroban network add testnet \
        --rpc-url https://soroban-testnet.stellar.org \
        --network-passphrase "Test SDF Network ; September 2015"
    echo -e "${GREEN}✓${NC} Testnet network added"
fi

# Check if admin identity exists
if soroban keys ls 2>/dev/null | grep -q "admin"; then
    echo -e "${GREEN}✓${NC} Admin identity already exists"
    ADMIN_ADDRESS=$(soroban keys address admin)
    echo "   Address: ${ADMIN_ADDRESS}"
else
    echo "Generating admin identity..."
    soroban keys generate admin --network testnet
    ADMIN_ADDRESS=$(soroban keys address admin)
    echo -e "${GREEN}✓${NC} Admin identity created"
    echo "   Address: ${ADMIN_ADDRESS}"
    echo ""
    echo -e "${YELLOW}!${NC} Fund this account with testnet XLM:"
    echo "   Visit: https://laboratory.stellar.org/#account-creator?network=test"
    echo "   Or run: curl \"https://friendbot.stellar.org?addr=${ADMIN_ADDRESS}\""
fi

echo ""
echo "Setting up environment files..."
echo ""

# Create backend .env if it doesn't exist
if [ ! -f backend/.env ]; then
    cp backend/.env.example backend/.env
    echo -e "${GREEN}✓${NC} Created backend/.env"
    echo -e "${YELLOW}!${NC} Please edit backend/.env with your configuration"
else
    echo -e "${GREEN}✓${NC} backend/.env already exists"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo -e "${GREEN}Setup Complete!${NC}"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo ""
echo "1. Fund your admin account with testnet XLM:"
echo "   curl \"https://friendbot.stellar.org?addr=${ADMIN_ADDRESS}\""
echo ""
echo "2. Create PostgreSQL database:"
echo "   createdb farmpay"
echo ""
echo "3. Build and deploy the Soroban contract:"
echo "   cd contracts/escrow"
echo "   cargo build --target wasm32-unknown-unknown --release"
echo "   soroban contract deploy \\"
echo "     --wasm target/wasm32-unknown-unknown/release/farmpay_escrow.wasm \\"
echo "     --source admin \\"
echo "     --network testnet"
echo ""
echo "4. Update backend/.env with:"
echo "   - Database connection string"
echo "   - Contract ID from step 3"
echo "   - Admin secret key"
echo ""
echo "5. Start the backend:"
echo "   cd backend"
echo "   npm run dev"
echo ""
echo "6. Start the frontend (in a new terminal):"
echo "   cd frontend"
echo "   npm run dev"
echo ""
echo "7. Open http://localhost:3000 in your browser"
echo ""
echo "For detailed instructions, see docs/GETTING_STARTED.md"
echo ""
echo "🌾 Happy coding!"
