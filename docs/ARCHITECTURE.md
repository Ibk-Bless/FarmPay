# FarmPay Architecture

## System Overview

FarmPay is a decentralized escrow platform built on Stellar that enables instant farm-to-buyer settlements.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Buyer      │  │   Farmer     │  │   Delivery   │      │
│  │  Dashboard   │  │  Dashboard   │  │   Profile    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ HTTP/REST
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend API (Node.js)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Orders     │  │   Farmers    │  │   Buyers     │      │
│  │   Routes     │  │   Routes     │  │   Routes     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Escrow     │  │   Payments   │  │   History    │      │
│  │   Service    │  │   Service    │  │   Service    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Stellar SDK
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      Stellar Network                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Soroban    │  │     USDC     │  │   Horizon    │      │
│  │   Escrow     │  │   Payments   │  │     API      │      │
│  │   Contract   │  │              │  │              │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    PostgreSQL Database                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │    Orders    │  │    Users     │  │   Metadata   │      │
│  │   (off-chain)│  │  (profiles)  │  │              │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### Frontend (React + TypeScript)
- User interface for buyers and farmers
- Wallet connection and management
- Order creation and tracking
- Delivery profile display
- Real-time status updates

### Backend API (Node.js + Express)
- RESTful API endpoints
- Business logic orchestration
- Database operations
- Stellar blockchain interactions
- Authentication and authorization

### Soroban Escrow Contract
- Payment locking mechanism
- Delivery confirmation logic
- Dispute handling
- Auto-release after dispute window
- On-chain state management

### Stellar Network
- USDC payment rails
- Transaction finality (5 seconds)
- On-chain delivery history
- Cross-border settlement
- Low-cost transactions

### PostgreSQL Database
- Off-chain metadata storage
- User profiles and preferences
- Order details and crop information
- Caching for performance
- Search and filtering

## Data Flow

### Order Creation Flow
1. Buyer creates order in frontend
2. Backend validates order details
3. Backend calls Soroban contract to lock payment
4. Contract transfers USDC to escrow
5. Order stored in database with escrow reference
6. Farmer notified of new order

### Delivery Confirmation Flow
1. Farmer delivers produce
2. Buyer confirms delivery in frontend
3. Backend calls Soroban contract to release payment
4. Contract transfers USDC to farmer's wallet
5. Transaction recorded on-chain
6. Database updated with completion status
7. Farmer's delivery profile updated

### Delivery Profile Construction
1. Query Stellar blockchain for farmer's transactions
2. Filter completed escrow releases
3. Aggregate delivery statistics
4. Format for public display
5. Cache in database for performance

## Security Considerations

### Smart Contract Security
- Escrow funds held in contract, not controlled by any party
- Time-locked dispute windows
- Authorization checks on all state changes
- Reentrancy protection
- Overflow/underflow protection

### API Security
- JWT-based authentication
- Rate limiting
- Input validation and sanitization
- CORS configuration
- Environment variable protection

### Wallet Security
- Private keys never leave user's device
- Transaction signing client-side
- Secure wallet connection protocols
- Clear transaction previews

## Scalability

### Current Design
- Supports thousands of concurrent orders
- Sub-second API response times
- 5-second blockchain finality
- Horizontal scaling via load balancing

### Future Optimizations
- Redis caching layer
- GraphQL for flexible queries
- WebSocket for real-time updates
- CDN for static assets
- Database read replicas

## Technology Choices

### Why Stellar?
- Fast finality (3-5 seconds)
- Low fees (~$0.0007/tx)
- Native USDC support
- Built-in DEX for currency conversion
- Soroban smart contracts

### Why React?
- Component reusability
- Large ecosystem
- TypeScript support
- Performance optimizations
- Developer familiarity

### Why Node.js?
- JavaScript/TypeScript consistency
- Stellar SDK support
- Async I/O for blockchain calls
- Large package ecosystem
- Easy deployment

### Why PostgreSQL?
- ACID compliance
- JSON support for flexible schemas
- Full-text search
- Mature and reliable
- Strong TypeScript integration
