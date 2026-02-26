# System-800

A production-grade, fault-tolerant retail monitoring and automation system.

## Overview

System-800 is a comprehensive platform for monitoring product availability across major retailers, detecting stock status changes in near real-time, sending structured alerts, and optionally performing automated checkout attempts.

### Key Features

- **Multi-Retailer Support**: Amazon, Best Buy, Walmart, Target, Newegg, and custom adapters
- **Real-Time Monitoring**: Configurable check intervals per SKU (30s - 1hr)
- **Intelligent Alerts**: Stock availability, price drops, price increases, errors
- **Auto-Checkout**: Automated purchase attempts with encrypted credential storage
- **Fault Tolerance**: Circuit breakers, exponential backoff, dead-letter queues
- **Zero Single Point of Failure**: Designed for high availability
- **Observable**: Structured logging, health checks, metrics

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           React Dashboard                                │
│                    (Vite + TanStack Query + Zustand)                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Express API Layer                               │
│              (Auth, Rate Limiting, Validation, Middleware)              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   Services    │         │  Queue Layer    │         │   Adapters      │
│  SKU, Auth,   │◄───────►│   (BullMQ)      │◄───────►│  (Puppeteer)    │
│  Alert, etc.  │         │ Per-Retailer Q  │         │ Amazon, etc.    │
└───────────────┘         └─────────────────┘         └─────────────────┘
        │                           │
        ▼                           ▼
┌───────────────┐         ┌─────────────────┐
│  PostgreSQL   │         │     Redis       │
│  (Persistent) │         │  (Queue/Cache)  │
└───────────────┘         └─────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 16+
- Redis 7+
- Docker (optional)

### Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/system-800.git
   cd system-800
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.template .env
   # Edit .env with your configuration
   ```

4. **Start infrastructure**
   ```bash
   docker compose up -d postgres redis
   ```

5. **Run migrations**
   ```bash
   npm run migrate --workspace=backend
   ```

6. **Start development servers**
   ```bash
   # Terminal 1: Backend
   npm run dev --workspace=backend

   # Terminal 2: Frontend
   npm run dev --workspace=frontend
   ```

### Docker Deployment

```bash
# Build and run all services
docker compose up --build

# With development tools (pgAdmin, Redis Commander)
docker compose --profile dev up --build
```

### Render Deployment

The `render.yaml` blueprint configures:
- Backend API (auto-scaling web service)
- Frontend (static site with CDN)
- PostgreSQL (managed database)
- Redis (managed cache)

## Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `NODE_ENV` | Environment (development/production/test) | No | development |
| `PORT` | API server port | No | 3000 |
| `DATABASE_URL` | PostgreSQL connection string | Yes | - |
| `REDIS_URL` | Redis connection string | Yes | - |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | Yes | - |
| `ENCRYPTION_KEY` | Credential encryption key (32 chars) | Yes | - |
| `LOG_LEVEL` | Logging level | No | info |
| `CORS_ORIGIN` | CORS allowed origins | No | * |

## API Reference

### Authentication

#### POST /api/v1/auth/register
Register a new user account.

```json
{
  "email": "user@example.com",
  "password": "securepassword123",
  "name": "John Doe"
}
```

#### POST /api/v1/auth/login
Authenticate and receive tokens.

```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

#### POST /api/v1/auth/refresh
Refresh access token.

```json
{
  "refreshToken": "eyJ..."
}
```

### SKUs

#### GET /api/v1/skus
List all SKUs for authenticated user.

#### POST /api/v1/skus
Create a new SKU to monitor.

```json
{
  "name": "PlayStation 5",
  "url": "https://www.amazon.com/dp/B09BNFWW5V",
  "retailer": "amazon",
  "target_price": 499.99,
  "auto_checkout": false,
  "priority": 5,
  "check_interval": 60
}
```

#### GET /api/v1/skus/:id
Get SKU details.

#### PATCH /api/v1/skus/:id
Update SKU.

#### DELETE /api/v1/skus/:id
Delete SKU.

#### POST /api/v1/skus/:id/pause
Pause monitoring for SKU.

#### POST /api/v1/skus/:id/resume
Resume monitoring for SKU.

### Alerts

#### GET /api/v1/alerts
List alerts with optional filters.

Query parameters:
- `acknowledged`: boolean
- `type`: alert type
- `page`: page number
- `limit`: items per page

#### POST /api/v1/alerts/:id/acknowledge
Acknowledge an alert.

### Checkouts

#### GET /api/v1/checkout
List checkout attempts.

#### GET /api/v1/checkout/stats
Get checkout statistics.

### System

#### GET /health
Health check endpoint.

#### GET /api/v1/system/metrics
System metrics (authenticated).

## Project Structure

```
system-800/
├── backend/
│   └── src/
│       ├── api/              # Express routes, controllers, middleware
│       ├── adapters/         # Retailer adapters (Puppeteer)
│       ├── config/           # Configuration with Zod validation
│       ├── observability/    # Logging, metrics, health checks
│       ├── persistence/      # PostgreSQL repositories, migrations
│       ├── queue/            # BullMQ queues, workers, scheduler
│       ├── services/         # Business logic
│       ├── types/            # TypeScript types and enums
│       ├── utils/            # Shared utilities
│       └── __tests__/        # Test suites
├── frontend/
│   └── src/
│       ├── components/       # React components
│       ├── hooks/            # Custom hooks
│       ├── lib/              # API client
│       ├── pages/            # Page components
│       ├── store/            # Zustand stores
│       └── types/            # TypeScript types
├── .github/workflows/        # CI/CD pipelines
├── docker-compose.yml        # Local development stack
├── Dockerfile               # Multi-stage build
├── nginx.conf               # Frontend reverse proxy
└── render.yaml              # Render deployment blueprint
```

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific workspace
npm test --workspace=backend
npm test --workspace=frontend
```

The test suite targets 90%+ coverage across:
- Unit tests for utilities, services, repositories
- Integration tests for API endpoints
- Worker/queue processing tests
- Adapter tests

## Monitoring

### Health Checks

- `/health` - Overall system health
- Checks PostgreSQL, Redis connectivity
- Reports uptime and version

### Metrics

- Request latency histograms
- Queue depths per retailer
- Error rates by category
- Memory and CPU utilization

### Logging

Structured JSON logging via Pino:
- Request/response logging
- Error tracking with stack traces
- Sensitive field redaction
- Log levels: trace, debug, info, warn, error, fatal

## Security

- **Authentication**: JWT with PBKDF2 password hashing
- **Authorization**: Role-based (user/admin)
- **Encryption**: AES-256-CBC for credential storage
- **Rate Limiting**: Per-IP request throttling
- **Input Validation**: Zod schema validation
- **Security Headers**: Helmet.js, CORS configuration
- **Audit Logging**: Authentication events tracked

## Fault Tolerance

### Circuit Breaker Pattern
- Prevents cascade failures
- Auto-recovery with half-open state
- Configurable thresholds

### Retry with Exponential Backoff
- Jitter factor for thundering herd prevention
- Configurable max attempts and delays
- Custom retry predicates

### Dead Letter Queue
- Failed jobs captured for analysis
- Manual reprocessing capability
- Error tracking and resolution

### Per-Retailer Queue Isolation
- Failures isolated to single retailer
- Independent scaling and rate limits
- Prevents cross-contamination

## Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - see LICENSE file for details.
