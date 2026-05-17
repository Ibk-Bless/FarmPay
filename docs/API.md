# FarmPay API Documentation

Base URL: `http://localhost:4000/api` (development)

## Authentication

All authenticated endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer <token>
```

## Endpoints

### Health Check

**GET** `/health`

Check API server status.

**Response:**
```json
{
  "status": "ok",
  "message": "FarmPay API is running"
}
```

---

### Orders

#### Create Order

**POST** `/orders`

Create a new purchase order and lock payment in escrow.

**Request Body:**
```json
{
  "buyerId": "GABC123...",
  "farmerId": "GDEF456...",
  "crop": "Maize",
  "quantity": 5000,
  "unit": "kg",
  "pricePerUnit": 0.42,
  "totalAmount": 2100,
  "deliveryDeadline": "2026-08-15T00:00:00Z",
  "disputeWindowDays": 3
}
```

**Response:**
```json
{
  "orderId": "ord_abc123",
  "status": "locked",
  "escrowTxHash": "abc123...",
  "createdAt": "2026-05-17T10:00:00Z"
}
```

#### Get Order

**GET** `/orders/:orderId`

Retrieve order details.

**Response:**
```json
{
  "orderId": "ord_abc123",
  "buyerId": "GABC123...",
  "farmerId": "GDEF456...",
  "crop": "Maize",
  "quantity": 5000,
  "unit": "kg",
  "totalAmount": 2100,
  "status": "locked",
  "deliveryDeadline": "2026-08-15T00:00:00Z",
  "disputeDeadline": "2026-08-18T00:00:00Z",
  "createdAt": "2026-05-17T10:00:00Z"
}
```

#### List Orders

**GET** `/orders?userId=<stellarAddress>&role=<buyer|farmer>&status=<status>`

List orders for a user.

**Query Parameters:**
- `userId` (required): Stellar address
- `role` (required): "buyer" or "farmer"
- `status` (optional): "locked", "released", "disputed", "cancelled"

**Response:**
```json
{
  "orders": [
    {
      "orderId": "ord_abc123",
      "crop": "Maize",
      "quantity": 5000,
      "totalAmount": 2100,
      "status": "locked",
      "createdAt": "2026-05-17T10:00:00Z"
    }
  ],
  "total": 1
}
```

#### Confirm Delivery

**POST** `/orders/:orderId/confirm`

Buyer confirms delivery and releases payment.

**Request Body:**
```json
{
  "buyerId": "GABC123...",
  "notes": "Delivery received in good condition"
}
```

**Response:**
```json
{
  "orderId": "ord_abc123",
  "status": "released",
  "releaseTxHash": "def456...",
  "releasedAt": "2026-08-15T14:30:00Z"
}
```

#### Initiate Dispute

**POST** `/orders/:orderId/dispute`

Buyer raises a dispute about delivery.

**Request Body:**
```json
{
  "buyerId": "GABC123...",
  "reason": "Quantity delivered was less than ordered"
}
```

**Response:**
```json
{
  "orderId": "ord_abc123",
  "status": "disputed",
  "disputeReason": "Quantity delivered was less than ordered",
  "disputedAt": "2026-08-15T14:30:00Z"
}
```

---

### Farmers

#### Get Farmer Profile

**GET** `/farmers/:farmerId`

Retrieve farmer profile and statistics.

**Response:**
```json
{
  "farmerId": "GDEF456...",
  "name": "Amara Diallo",
  "location": "Ghana",
  "joinedAt": "2025-01-15T00:00:00Z",
  "stats": {
    "totalDeliveries": 12,
    "completedDeliveries": 12,
    "onTimeRate": 100,
    "totalValueDelivered": 25400
  }
}
```

#### Get Farmer Delivery History

**GET** `/farmers/:farmerId/history`

Retrieve farmer's on-chain delivery history.

**Response:**
```json
{
  "farmerId": "GDEF456...",
  "deliveries": [
    {
      "orderId": "ord_abc123",
      "crop": "Cashew",
      "quantity": 2000,
      "buyer": "West Africa Exports Ltd",
      "amount": 1840,
      "deliveredAt": "2025-03-20T00:00:00Z",
      "txHash": "abc123..."
    },
    {
      "orderId": "ord_def456",
      "crop": "Maize",
      "quantity": 5000,
      "buyer": "NutriFood Processing Co.",
      "amount": 2100,
      "deliveredAt": "2025-08-15T00:00:00Z",
      "txHash": "def456..."
    }
  ],
  "total": 2
}
```

---

### Buyers

#### Get Buyer Profile

**GET** `/buyers/:buyerId`

Retrieve buyer profile and statistics.

**Response:**
```json
{
  "buyerId": "GABC123...",
  "name": "West Africa Exports Ltd",
  "location": "Ghana",
  "joinedAt": "2024-11-01T00:00:00Z",
  "stats": {
    "totalOrders": 45,
    "completedOrders": 43,
    "activeOrders": 2,
    "totalValuePurchased": 125000
  }
}
```

#### Get Buyer Order History

**GET** `/buyers/:buyerId/history`

Retrieve buyer's order history.

**Response:**
```json
{
  "buyerId": "GABC123...",
  "orders": [
    {
      "orderId": "ord_abc123",
      "crop": "Cashew",
      "quantity": 2000,
      "farmer": "Amara Diallo",
      "amount": 1840,
      "status": "released",
      "completedAt": "2025-03-20T00:00:00Z"
    }
  ],
  "total": 43
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {}
  }
}
```

### Common Error Codes

- `400` - Bad Request (invalid input)
- `401` - Unauthorized (missing or invalid token)
- `404` - Not Found (resource doesn't exist)
- `409` - Conflict (order already confirmed, etc.)
- `500` - Internal Server Error

### Example Error Response

```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Buyer does not have sufficient USDC balance",
    "details": {
      "required": 2100,
      "available": 1500
    }
  }
}
```

---

## Rate Limiting

- **Rate Limit**: 100 requests per minute per IP
- **Headers**: 
  - `X-RateLimit-Limit`: Maximum requests per window
  - `X-RateLimit-Remaining`: Remaining requests
  - `X-RateLimit-Reset`: Time when limit resets (Unix timestamp)

---

## Webhooks (Future)

FarmPay will support webhooks for real-time notifications:

- `order.created` - New order created
- `order.accepted` - Farmer accepted order
- `order.delivered` - Delivery confirmed
- `order.disputed` - Dispute raised
- `payment.released` - Payment released to farmer

---

## SDK Support (Future)

Official SDKs planned for:
- JavaScript/TypeScript
- Python
- Go
- Rust
