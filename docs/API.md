# System-800 API Documentation

Base URL: `http://localhost:3000/api/v1`

## Authentication

All endpoints except `/auth/login` and `/auth/register` require authentication via Bearer token.

```
Authorization: Bearer <access_token>
```

---

## Auth Endpoints

### Register User

`POST /auth/register`

Creates a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123",
  "name": "John Doe"
}
```

**Response (201):**
```json
{
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "user"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Errors:**
- `400` - Validation error or email already exists

---

### Login

`POST /auth/login`

Authenticates a user and returns tokens.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response (200):**
```json
{
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "user"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Errors:**
- `401` - Invalid credentials
- `403` - Account disabled

---

### Refresh Token

`POST /auth/refresh`

Refreshes an expired access token.

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Errors:**
- `401` - Invalid or expired refresh token

---

### Get Current User

`GET /auth/me`

Returns the currently authenticated user.

**Response (200):**
```json
{
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "user",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

---

## SKU Endpoints

### List SKUs

`GET /skus`

Returns all SKUs for the authenticated user.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 20, max: 100) |
| `status` | string | Filter by monitoring_status |
| `retailer` | string | Filter by retailer |

**Response (200):**
```json
{
  "data": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "PlayStation 5",
      "url": "https://www.amazon.com/dp/B09BNFWW5V",
      "retailer": "amazon",
      "target_price": 499.99,
      "auto_checkout": false,
      "priority": 5,
      "monitoring_status": "active",
      "check_interval": 60,
      "last_checked_at": "2024-01-01T12:00:00.000Z",
      "last_stock_status": "out_of_stock",
      "last_price": 499.99,
      "consecutive_errors": 0,
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T12:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

---

### Create SKU

`POST /skus`

Creates a new SKU to monitor.

**Request Body:**
```json
{
  "name": "PlayStation 5",
  "url": "https://www.amazon.com/dp/B09BNFWW5V",
  "retailer": "amazon",
  "target_price": 499.99,
  "auto_checkout": false,
  "priority": 5,
  "check_interval": 60,
  "metadata": {
    "variant": "disc"
  }
}
```

**Required Fields:**
- `name` - Product name
- `url` - Product URL (must be HTTPS)
- `retailer` - One of: `amazon`, `bestbuy`, `walmart`, `target`, `newegg`, `custom`

**Optional Fields:**
- `target_price` - Trigger alerts/checkout below this price
- `auto_checkout` - Enable automated purchase (default: false)
- `priority` - 1-10, higher = more frequent checks (default: 5)
- `check_interval` - Seconds between checks, 30-3600 (default: 60)
- `metadata` - Custom JSON metadata

**Response (201):**
```json
{
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "name": "PlayStation 5",
    ...
  }
}
```

**Errors:**
- `400` - Validation error

---

### Get SKU

`GET /skus/:id`

Returns a single SKU by ID.

**Response (200):**
```json
{
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    ...
  }
}
```

**Errors:**
- `404` - SKU not found

---

### Update SKU

`PATCH /skus/:id`

Updates an existing SKU.

**Request Body:**
```json
{
  "name": "PS5 Console",
  "target_price": 449.99
}
```

**Response (200):**
```json
{
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    ...
  }
}
```

**Errors:**
- `400` - Validation error
- `404` - SKU not found

---

### Delete SKU

`DELETE /skus/:id`

Deletes a SKU.

**Response (204):** No content

**Errors:**
- `404` - SKU not found

---

### Pause Monitoring

`POST /skus/:id/pause`

Pauses monitoring for a SKU.

**Response (200):**
```json
{
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "monitoring_status": "paused",
    ...
  }
}
```

---

### Resume Monitoring

`POST /skus/:id/resume`

Resumes monitoring for a paused SKU.

**Response (200):**
```json
{
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "monitoring_status": "active",
    ...
  }
}
```

---

## Alert Endpoints

### List Alerts

`GET /alerts`

Returns alerts for the authenticated user.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 20) |
| `acknowledged` | boolean | Filter by acknowledged status |
| `type` | string | Filter by alert type |

**Alert Types:**
- `stock_available` - Product became in-stock
- `price_drop` - Price decreased
- `price_increase` - Price increased
- `checkout_success` - Auto-checkout succeeded
- `checkout_failed` - Auto-checkout failed
- `error` - Monitoring error occurred

**Response (200):**
```json
{
  "data": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "type": "stock_available",
      "message": "PlayStation 5 is now in stock at $499.99",
      "sku_id": "123e4567-e89b-12d3-a456-426614174001",
      "user_id": "123e4567-e89b-12d3-a456-426614174002",
      "acknowledged_at": null,
      "created_at": "2024-01-01T12:00:00.000Z",
      "metadata": {
        "price": 499.99,
        "retailer": "amazon"
      }
    }
  ],
  "pagination": { ... }
}
```

---

### Acknowledge Alert

`POST /alerts/:id/acknowledge`

Marks an alert as acknowledged.

**Response (200):**
```json
{
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "acknowledged_at": "2024-01-01T12:30:00.000Z",
    ...
  }
}
```

---

### Acknowledge All Alerts

`POST /alerts/acknowledge-all`

Acknowledges all unacknowledged alerts.

**Response (200):**
```json
{
  "acknowledged": 5
}
```

---

## Checkout Endpoints

### List Checkout Attempts

`GET /checkout`

Returns checkout attempt history.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 20) |
| `status` | string | Filter by status |

**Status Values:**
- `pending` - Checkout queued
- `in_progress` - Checkout running
- `succeeded` - Checkout completed
- `failed` - Checkout failed
- `cancelled` - Checkout cancelled

**Response (200):**
```json
{
  "data": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "sku_id": "123e4567-e89b-12d3-a456-426614174001",
      "user_id": "123e4567-e89b-12d3-a456-426614174002",
      "status": "succeeded",
      "started_at": "2024-01-01T12:00:00.000Z",
      "completed_at": "2024-01-01T12:01:00.000Z",
      "total_price": 499.99,
      "order_id": "111-2222222-3333333",
      "attempt_number": 1
    }
  ],
  "pagination": { ... }
}
```

---

### Get Checkout Statistics

`GET /checkout/stats`

Returns checkout statistics.

**Response (200):**
```json
{
  "total": 100,
  "pending": 2,
  "in_progress": 1,
  "succeeded": 85,
  "failed": 10,
  "cancelled": 2,
  "success_rate": 85.0
}
```

---

## Credential Endpoints

### List Credentials

`GET /credentials`

Returns stored retailer credentials (passwords are NOT returned).

**Response (200):**
```json
{
  "data": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "retailer": "amazon",
      "username": "user@example.com",
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### Add Credential

`POST /credentials`

Stores a new retailer credential (encrypted at rest).

**Request Body:**
```json
{
  "retailer": "amazon",
  "username": "user@example.com",
  "password": "retailer-password"
}
```

**Response (201):**
```json
{
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "retailer": "amazon",
    "username": "user@example.com",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

---

### Delete Credential

`DELETE /credentials/:id`

Deletes a stored credential.

**Response (204):** No content

---

## System Endpoints

### Health Check

`GET /health`

Returns system health status (no auth required).

**Response (200):**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 86400,
  "checks": {
    "database": {
      "status": "up",
      "latency": 5
    },
    "redis": {
      "status": "up",
      "latency": 2
    }
  }
}
```

**Status Values:**
- `healthy` - All systems operational
- `degraded` - Some systems impaired
- `unhealthy` - Critical systems down

---

### System Metrics

`GET /system/metrics`

Returns detailed system metrics (requires authentication).

**Response (200):**
```json
{
  "memory": {
    "rss": 104857600,
    "heapUsed": 52428800,
    "heapTotal": 78643200,
    "external": 1048576
  },
  "eventLoop": {
    "min": 0.1,
    "max": 10.5,
    "mean": 1.2,
    "stddev": 0.8
  },
  "queues": {
    "monitoring:amazon": {
      "waiting": 10,
      "active": 2,
      "completed": 1000,
      "failed": 5,
      "delayed": 0
    },
    "monitoring:bestbuy": { ... },
    "checkout": { ... },
    "alert": { ... }
  }
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": { ... }
}
```

### Common HTTP Status Codes

| Code | Description |
|------|-------------|
| 400 | Bad Request - Validation failed |
| 401 | Unauthorized - Missing or invalid token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error |

---

## Rate Limiting

API requests are rate limited per IP address:

- **General endpoints**: 100 requests per minute
- **Auth endpoints**: 20 requests per minute
- **Checkout endpoints**: 10 requests per minute

Rate limit headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1704067200
```

When rate limited, response:
```json
{
  "error": "Too many requests, please try again later",
  "retryAfter": 30
}
```
