# FarmPay Deployment Guide

## Prerequisites

- Node.js 18+
- Rust and Cargo (for Soroban contracts)
- PostgreSQL 14+
- Stellar account with testnet XLM
- Soroban CLI installed

## Environment Setup

### 1. Install Soroban CLI

```bash
cargo install --locked soroban-cli
```

### 2. Configure Stellar Network

```bash
# Add testnet network
soroban network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"

# Create admin identity
soroban keys generate admin --network testnet
```

### 3. Database Setup

```bash
# Create database
createdb farmpay

# Run migrations (to be created)
npm run migrate
```

## Contract Deployment

### 1. Build Contract

```bash
cd contracts/escrow
cargo build --target wasm32-unknown-unknown --release
```

### 2. Optimize WASM

```bash
soroban contract optimize \
  --wasm target/wasm32-unknown-unknown/release/farmpay_escrow.wasm
```

### 3. Deploy to Testnet

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/farmpay_escrow.wasm \
  --source admin \
  --network testnet
```

Save the contract ID to your `.env` file.

### 4. Initialize Contract

```bash
# Initialize contract with admin settings
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- initialize \
  --admin <ADMIN_ADDRESS>
```

## Backend Deployment

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Build

```bash
npm run build
```

### 4. Start Server

```bash
# Development
npm run dev

# Production
npm start
```

## Frontend Deployment

### 1. Install Dependencies

```bash
cd frontend
npm install
```

### 2. Configure Environment

Create `.env.production`:

```bash
VITE_API_URL=https://api.farmpay.io
VITE_STELLAR_NETWORK=testnet
VITE_HORIZON_URL=https://horizon-testnet.stellar.org
VITE_ESCROW_CONTRACT_ID=<CONTRACT_ID>
```

### 3. Build

```bash
npm run build
```

### 4. Deploy

Deploy the `dist/` folder to your hosting provider:

**Vercel:**
```bash
vercel --prod
```

**Netlify:**
```bash
netlify deploy --prod --dir=dist
```

**AWS S3 + CloudFront:**
```bash
aws s3 sync dist/ s3://farmpay-frontend
aws cloudfront create-invalidation --distribution-id <ID> --paths "/*"
```

## Production Checklist

### Security
- [ ] Environment variables secured
- [ ] HTTPS enabled
- [ ] CORS configured correctly
- [ ] Rate limiting enabled
- [ ] Input validation in place
- [ ] SQL injection protection
- [ ] XSS protection

### Performance
- [ ] Database indexes created
- [ ] API response caching
- [ ] CDN configured
- [ ] Image optimization
- [ ] Bundle size optimized
- [ ] Lazy loading implemented

### Monitoring
- [ ] Error tracking (Sentry)
- [ ] Performance monitoring
- [ ] Uptime monitoring
- [ ] Log aggregation
- [ ] Alerting configured

### Backup
- [ ] Database backups automated
- [ ] Backup restoration tested
- [ ] Contract state backup plan
- [ ] Disaster recovery documented

## Mainnet Deployment

### 1. Update Network Configuration

```bash
# Add mainnet network
soroban network add mainnet \
  --rpc-url https://soroban-mainnet.stellar.org \
  --network-passphrase "Public Global Stellar Network ; September 2015"
```

### 2. Fund Admin Account

Transfer XLM to admin account for deployment fees.

### 3. Deploy Contract

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/farmpay_escrow.wasm \
  --source admin \
  --network mainnet
```

### 4. Update Environment Variables

Update all `.env` files to use mainnet:
- `STELLAR_NETWORK=mainnet`
- `STELLAR_HORIZON_URL=https://horizon.stellar.org`
- New `ESCROW_CONTRACT_ID`

### 5. Test Thoroughly

- Create test order with small amount
- Verify escrow locking
- Test delivery confirmation
- Verify payment release
- Check on-chain history

## Monitoring and Maintenance

### Health Checks

```bash
# API health
curl https://api.farmpay.io/api/health

# Contract status
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network mainnet \
  -- get_status
```

### Logs

```bash
# Backend logs
pm2 logs farmpay-api

# Database logs
tail -f /var/log/postgresql/postgresql-14-main.log
```

### Updates

```bash
# Update contract
soroban contract deploy \
  --wasm <NEW_WASM> \
  --source admin \
  --network mainnet

# Update backend
git pull
npm install
npm run build
pm2 restart farmpay-api

# Update frontend
git pull
npm install
npm run build
# Deploy to hosting
```

## Troubleshooting

### Contract Deployment Fails
- Check admin account has sufficient XLM
- Verify network configuration
- Check WASM file is optimized

### API Connection Issues
- Verify Horizon URL is correct
- Check network connectivity
- Verify contract ID is correct

### Database Connection Fails
- Check PostgreSQL is running
- Verify connection string
- Check firewall rules

### Frontend Build Fails
- Clear node_modules and reinstall
- Check Node.js version
- Verify environment variables

## Support

For deployment issues:
- GitHub Issues: [repository-url]/issues
- Documentation: [docs-url]
- Community: [discord/telegram]
