# Order Splitter API

A NestJS + TypeScript REST API for a robo-advisor platform. A partner sends a model portfolio
(symbols + weights), a total amount and an order type (`BUY` / `SELL`). The service returns the
**amount and share quantity per stock**, **the date the orders should run**, and keeps a
**history of calculated orders** (in memory by default, so it disappears on restart).

> The service only *calculates order instructions*. It never places trades with a broker.

**Contents:** [Quick start](#quick-start) · [Our approach](#our-approach-in-one-page) ·
[SOLID, with real examples](#solid-principles-where-to-see-them-in-the-code) ·
[Measures we took](#measures-we-took) · [How to upgrade](#how-to-upgrade-recipes) ·
[API](#api) · [Architecture](#architecture) · [Configuration](#configuration) ·
[Limitations](#current-limitations)

---

## Quick start

Needs **Node.js ≥ 20** and npm. No database or other service is required.

```bash
npm install
npm run build
npm start          # http://localhost:3000   Swagger UI: http://localhost:3000/docs
```

Other commands:

```bash
npm test               # 176 unit + integration tests
npm run test:cov       # with coverage (CI fails below the threshold)
npm run lint && npm run typecheck
docker compose --profile app up --build    # API + PostgreSQL in containers
```

---

## Our approach in one page

**1. Keep the business rules pure.** The maths (split an amount by weights, turn money into shares,
pick the execution date) lives in small classes that do no I/O and know nothing about HTTP or
databases. They are easy to test and hard to break.

**2. Put everything that may change behind a small interface.** Price source, market calendar,
storage and authentication are each an interface plus one default implementation. Replacing one is
"write a new class, change one line of wiring". Nothing else is touched.

**3. Never use floating-point for money.** All amounts use `decimal.js` and travel as strings in
JSON. Cents lost to rounding are given back with the largest-remainder method, so allocations always add
up to the total exactly.

**4. Fail early and loudly.** Bad configuration stops the app at startup (and lists every problem).
Bad requests are rejected at the first checkpoint that notices, with one consistent error shape.

**5. Safe by default, production-ready by switches.** The default run is the simple challenge
behaviour. A `NODE_ENV=production` run refuses unsafe settings and turns on hardening.

**6. Prove it.** Every rule and every safety measure has a test. The same contract tests run against both
storage implementations.

```mermaid
flowchart LR
  C([Client]) --> H[Helmet, CORS,<br/>JSON logging, metrics]
  H --> RL[Rate limit]
  RL --> A[Auth + scopes]
  A --> V[Validation<br/>DTOs]
  V --> CT[Controller<br/>HTTP only]
  CT --> UC[Use case<br/>orchestrates]
  UC --> D[Domain rules<br/>pure maths]
  UC --> P[(Pricing)]
  UC --> M[(Calendar)]
  UC --> R[(Order repository<br/>memory / PostgreSQL)]
  EF[One error filter] -.-> C
```

Dependency rule: **controller → use case → domain and interfaces ← adapters**. The domain imports
nothing from Nest or from infrastructure.

---

## SOLID principles: where to see them in the code

| Principle | How we apply it | Where |
|---|---|---|
| **S**ingle responsibility: one reason to change | Each class has one job. The controller only translates HTTP. The use case only orchestrates. `AllocationService` only splits money. `QuantityCalculatorService` only converts money to shares. `validatePortfolio` only checks portfolio rules. `AllExceptionsFilter` only shapes errors. | `modules/orders/*`, `common/filters/` |
| **O**pen/closed: extend without editing | Adding a new auth scheme, price source, calendar or database means adding a class, not editing the use case. The Postgres storage was added without changing a single use case or controller line. | `AuthStrategy`, `PricingProvider`, `MarketCalendarProvider`, `OrderRepository` |
| **L**iskov substitution: implementations are interchangeable | `InMemoryOrderRepository` and `PostgresOrderRepository` honour the same contract (tenant isolation, newest-first, idempotency). The idempotency test suite runs unchanged against both. | `test/integration/idempotency.int.spec.ts` |
| **I**nterface segregation: small, focused interfaces | `AuthStrategy` has one method. `PricingProvider` has one. `MarketCalendarProvider` has one. The Postgres repository depends only on `Pick<OrdersDatabase, 'query'>`, not the whole database class. | `*.interface.ts`, `postgres-order.repository.ts` |
| **D**ependency inversion: depend on abstractions | Use cases inject interfaces through DI tokens (`ORDER_REPOSITORY`, `PRICING_PROVIDER`, `MARKET_CALENDAR`, `AUTH_STRATEGY`), plus `Clock` and `APP_CONFIG`. Concrete classes are chosen in one place per module (the composition root). Time is injected, so tests control "now". | `orders.module.ts`, `auth.module.ts`, `common/clock.ts` |

Honest notes: the storage choice is still one `if` in `orders.module.ts` (the composition root,
which is the right place for it). `OrderRepository` has four methods; if it grows, split it into a
read side and a write side (interface segregation again).

---

## Measures we took

### Correctness
| Measure | Detail |
|---|---|
| Exact money maths | `decimal.js`; amounts and quantities are strings in every response |
| Strict validation | DTO rules + business rules (weights sum to 100, no duplicate symbols, price > 0, valid timezone); unknown fields are rejected |
| Explicit rounding | Shares round **down**; `executableAmount` and `unusedAmount` show the gap |
| Idempotent POST | `Idempotency-Key` header: retries return the same order, no duplicates, race-safe |

### Security
| Measure | Detail |
|---|---|
| Authentication | Pluggable: `none` (dev), `api-key` (SHA-256 digests), `jwt` (HS256 pinned, issuer/audience). Custom strategy supported |
| Authorization | JWT `scope` enforced when present (`orders:write`, `orders:read`) |
| Tenant isolation | Every read is filtered by the caller's partner id at the storage layer; another partner's order looks like a 404 |
| HTTP hardening | `helmet` headers, CORS allow-list (none by default), rate limiting with `429`, 100 kb body limit, `x-powered-by` removed |
| Safe errors | One error shape; no stack traces or parser internals in responses; 500s carry a generic message |
| Safe logs | `authorization` / `x-api-key` redacted; query strings never logged |
| Production guard | `NODE_ENV=production` refuses `AUTH_MODE=none` and `ORDERS_DB_AUTO_SCHEMA=true`; Swagger off unless enabled |
| SQL safety | Parameterised queries only (tested) |
| Supply chain | `npm audit` in CI, lock file, non-root container |

### Reliability
| Measure | Detail |
|---|---|
| Fail-fast config | All problems listed at startup, exit code 1 |
| Database resilience | Startup retries with exponential backoff, connect and query timeouts, pool error handler, graceful pool shutdown |
| Health probes | Liveness (`/health`) and readiness (`/health/ready`, pings the database) |
| Memory guard | In-memory history is capped (`MAX_STORED_ORDERS`), oldest evicted in O(1) |
| Graceful shutdown | Shutdown hooks close the pool; the container runs `node` directly so SIGTERM arrives |

### Observability
| Measure | Detail |
|---|---|
| Structured logs | JSON (pino): one access line per request with `responseTime` (ms) |
| Correlation id | Accepted if well-formed or generated; returned in a header, error bodies, and **every** log line of that request |
| Metrics | Prometheus at `/api/v1/metrics`: Node runtime + request duration by route pattern and status |

### Quality and delivery
| Measure | Detail |
|---|---|
| Tests | 176 tests: unit (domain, providers, config, use case with mocked ports) and integration (real HTTP pipeline via Supertest, PostgreSQL SQL via `pg-mem`) |
| CI | GitHub Actions: lint, typecheck, tests with coverage gate, build, `npm audit`, image build (Node 20 and 22) |
| Container | Multi-stage `Dockerfile`: production dependencies only, non-root, `HEALTHCHECK` |
| Types and style | TypeScript `strict`, ESLint, Prettier |
| API contract | Response DTOs with Swagger schemas; the domain model is not exposed directly |

---

## How to upgrade: recipes

Each recipe says what to add and which existing code stays untouched.

| I want to… | Do this | Untouched |
|---|---|---|
| **Use live prices** | Create `MarketDataPricingProvider implements PricingProvider`; bind it to `PRICING_PROVIDER` in `pricing.module.ts`. Add a timeout and a stale-price rule. | Use case, domain, controller |
| **Honour holidays / trading hours** | Create `ExchangeCalendarProvider implements MarketCalendarProvider`; bind it to `MARKET_CALENDAR`. Cache the answers (they change rarely). | Everything else |
| **Use another database** (MongoDB, DynamoDB) | Implement `OrderRepository` (same 4 methods). Add the new value to `STORAGE` in `config/app.config.ts` and one branch in `orders.module.ts`. Run the idempotency suite against it. | Use cases, controller, DTOs |
| **Add OAuth2 / Auth0 / Cognito (RS256)** | Implement `AuthStrategy` (verify via JWKS) or use `createFunctionStrategy`; pass it to `AppModule.register({ auth })`. | Guard, controllers |
| **Change share precision** (3 → 7) | Set `SHARE_PRECISION=7`. No code change. | Everything |
| **Get portfolios from a database** | Add a `PortfolioProvider` interface + adapter; the use case asks it for holdings instead of reading them from the request. | Pricing, calendar, repository |
| **Add database migrations** | Use `node-pg-migrate` (or similar). Put the SQL from `orders.schema.ts` into the first migration, run it as a release step, keep `ORDERS_DB_AUTO_SCHEMA=false`. | Repository code |
| **Scale out** | Run several containers behind a load balancer. Needs `STORAGE=postgres` first (memory is per instance). Set `TRUST_PROXY_HOPS`. Rate limit counters are per instance; use a Redis store for a global limit. | Business code |
| **Execute orders asynchronously** | Publish the calculated order to a queue (SQS / RabbitMQ / Kafka) from the use case via a new `OrderPublisher` interface; workers call the broker. | Domain |
| **Release a breaking API change** | Add `v2` controllers with their own DTOs next to `v1` (the global prefix is `API_PREFIX`); keep `v1` until partners move. | Domain, use cases |
| **Add tracing** | Add OpenTelemetry auto-instrumentation at startup; the correlation id already ties logs together. | Business code |
| **Global rate limits / quotas** | Move limiting to an API gateway, or give `@nestjs/throttler` a Redis storage. | Controllers |

Rules for any change:
1. Business rule → `domain/` (pure, unit-tested first).
2. New external system → interface in the module + adapter + one binding. Never import a driver in a use case.
3. New setting → `config/app.config.ts` with validation, then `.env.example`.
4. Every new adapter must pass the same contract tests as the existing one.

---

## API

Base path `/api/v1`. Interactive docs: `/docs` (enabled outside production).

### `POST /api/v1/orders/split` → `201 Created`

| Field | Type | Rules |
|---|---|---|
| `type` | `"BUY"` \| `"SELL"` | required |
| `totalAmount` | number or numeric string | required, > 0, ≤ 2 decimals (USD) |
| `portfolio[]` | array (1–100) | required |
| `portfolio[].symbol` | string | 1–10 letters (`.`/`-` allowed), case-insensitive, unique |
| `portfolio[].weight` | number or numeric string | > 0, ≤ 100, ≤ 4 decimals; **all weights sum to exactly 100** |
| `marketPrices` | `{ "SYMBOL": price }` | optional; price > 0; overrides the default price; symbols must be in the portfolio |
| `timezone` | IANA string | optional; overrides `MARKET_TIMEZONE` for this request |

Optional header `Idempotency-Key` (1–128 printable ASCII): repeating the same key and body returns the
original order with `Idempotent-Replayed: true`. Same key with a different body → `422 IDEMPOTENCY_KEY_REUSED`.

```bash
curl -X POST http://localhost:3000/api/v1/orders/split \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-2026-0001" \
  -d '{ "type": "BUY", "totalAmount": 100,
        "portfolio": [ {"symbol":"AAPL","weight":60}, {"symbol":"TSLA","weight":40} ] }'
```

```json
{
  "id": "7fea6732-3e9d-4a1e-bd53-2fd6543eee0d",
  "partnerId": "anonymous",
  "type": "BUY",
  "currency": "USD",
  "totalAmount": "100.00",
  "allocations": [
    { "symbol": "AAPL", "weightPercent": "60", "price": "100", "priceSource": "DEFAULT",
      "allocatedAmount": "60.00", "quantity": "0.600", "executableAmount": "60.00" },
    { "symbol": "TSLA", "weightPercent": "40", "price": "100", "priceSource": "DEFAULT",
      "allocatedAmount": "40.00", "quantity": "0.400", "executableAmount": "40.00" }
  ],
  "summary": { "totalExecutableAmount": "100.00", "unusedAmount": "0.00" },
  "rounding": { "quantityPrecision": 3, "mode": "ROUND_DOWN", "note": "Quantities are truncated to 3 decimal places." },
  "schedule": { "executionDate": "2026-11-16", "status": "SAME_DAY", "timezone": "UTC", "requestedAt": "2026-11-16T10:00:00.000Z" },
  "status": "CALCULATED",
  "createdAt": "2026-11-16T10:00:00.000Z",
  "notice": "Calculated order instruction only; no trade has been placed with a broker. ..."
}
```

With a partner price (`"marketPrices": {"AAPL": 187.5}`) AAPL is priced at 187.5 (`priceSource: "PARTNER"`) → `quantity: "0.320"`.
The response also sets `Location: /api/v1/orders/{id}`.

### Other endpoints

| Endpoint | Purpose |
|---|---|
| `GET /orders?limit=50&offset=0` | History, newest first. Returns `{ data, total, limit, offset }`. `limit` 1–200 |
| `GET /orders/{id}` | One order; `404` if unknown or owned by another partner |
| `GET /health` | Liveness (public). Never touches dependencies |
| `GET /health/ready` | Readiness (public): `200` or `503`; pings the database when `STORAGE=postgres` |
| `GET /metrics` | Prometheus metrics (public: keep on the internal network or `METRICS_ENABLED=false`) |

### Errors

Every error has the same shape.

```json
{
  "statusCode": 422,
  "error": "Unprocessable Entity",
  "code": "INVALID_WEIGHT_TOTAL",
  "message": "Portfolio weights must add up to 100 (received 90)",
  "details": { "total": "90" },
  "correlationId": "3b0c…",
  "timestamp": "2026-11-16T10:00:00.000Z",
  "path": "/api/v1/orders/split"
}
```

| Status | When | `code` |
|---|---|---|
| 400 | Malformed JSON, schema violations, bad `Idempotency-Key`, non-UUID id | `VALIDATION_FAILED`, `BAD_REQUEST` |
| 401 | Auth enabled, credentials missing/invalid | `UNAUTHORIZED` |
| 403 | JWT lacks a required scope | `INSUFFICIENT_SCOPE` |
| 404 | Unknown order (or another partner's) | `ORDER_NOT_FOUND` |
| 413 | Body over 100 kb | `PAYLOAD_TOO_LARGE` |
| 422 | Business rule fails | `INVALID_WEIGHT_TOTAL`, `DUPLICATE_SYMBOL`, `PRICE_SYMBOL_NOT_IN_PORTFOLIO`, `INVALID_PRICE`, `IDEMPOTENCY_KEY_REUSED` |
| 429 | Rate limit exceeded | `RATE_LIMITED` |
| 500 | Unexpected (generic message; details only in the server log) | `INTERNAL_ERROR` |

### Business rules

* **Allocation** = `totalAmount × weight / 100` in cents; lost cents are redistributed (largest remainder).
* **Quantity** = `allocation ÷ price`, truncated to `SHARE_PRECISION` places. Example: 33.33 / 33.33 / 33.34 at $100 → 0.333 shares each → $0.10 unused.
* **Price** = `DEFAULT_PRICE` unless the partner sends `marketPrices[symbol]`.
* **Schedule**: Mon–Fri → `SAME_DAY`; Sat/Sun → `NEXT_MARKET_DAY` (following Monday). The weekday is evaluated in the request timezone. Hours and holidays are not modelled.

### Authentication

| Mode | Client sends | Notes |
|---|---|---|
| `none` (default) | nothing | Dev only; a warning is logged; refused in production |
| `api-key` | `X-API-Key: <key>` | keys from `API_KEYS`, stored as SHA-256 digests |
| `jwt` | `Authorization: Bearer <jwt>` | HS256 pinned; partner = `sub`; `scope` claim enforced when present (`orders:write` for POST, `orders:read` for GET). Tokens without `scope` are not restricted |

Custom scheme: write a function or implement `AuthStrategy` and pass it to `AppModule.register({ auth })`:

```ts
createFunctionStrategy('partner-header', (req) =>
  req.headers['x-partner'] ? { partnerId: String(req.headers['x-partner']) } : null);
```

---

## Architecture

A modular monolith. Anything that may be swapped sits behind a small interface injected through a
Nest DI token.

### Request path

| # | Step | Component | Fails with |
|---|---|---|---|
| 1 | Security headers, CORS | `helmet`, `enableCors` | CORS block (browser) |
| 2 | Parse body (≤ 100 kb) | Express | `400` / `413` |
| 3 | Correlation id, access log, metrics timer | pino-http, `MetricsMiddleware` | never |
| 4 | Rate limit | `ThrottlerGuard` | `429` |
| 5 | Authenticate + scopes | `AuthGuard` + `AuthStrategy` | `401` / `403` |
| 6 | Validate shape | `ValidationPipe` + DTOs | `400` |
| 7 | Business rules | `validatePortfolio` | `422` |
| 8 | Price, allocate, quantity | `PricingProvider`, `AllocationService`, `QuantityCalculatorService` | `422` |
| 9 | Schedule | `MarketCalendarProvider` | `422` |
| 10 | Save (or replay by idempotency key) | `OrderRepository` | `422` / `500` |
| 11 | Respond | Controller maps the order to a response DTO | – |

Any failure anywhere goes through `AllExceptionsFilter`, which produces the one error shape.

### Storage

| `STORAGE` | History kept in | Survives restart | Needs |
|---|---|---|---|
| `memory` (default) | A `Map` in the process | No (as the challenge requires) | nothing |
| `postgres` | Table `orders` | Yes | PostgreSQL |

```bash
docker compose up -d orders-db
STORAGE=postgres ORDERS_DB_URL=postgresql://orders_app:orders_pw@localhost:5432/orders \
ORDERS_DB_AUTO_SCHEMA=true npm start
```

`OrdersDatabase` owns one connection pool (startup retries, `SELECT 1` check, shutdown close).
`PostgresOrderRepository` runs parameterised SQL filtered by `partner_id`. The full order is stored as
`jsonb`; filtered columns are real, indexed columns. A unique index on `(partner_id, idempotency_key)`
makes retries safe under concurrency. Tests run the SQL on `pg-mem`; run the flow once against a real
PostgreSQL before relying on it.

### Project structure

```
src/
├── main.ts, bootstrap.ts, app.module.ts   # start-up, shared HTTP pipeline, wiring
├── config/                                # env parsing + validation (fail fast), DB settings
├── common/                                # clock, decimal, errors, error filter, logging, http helpers, validators
└── modules/
    ├── orders/
    │   ├── orders.controller.ts           # HTTP only
    │   ├── dto/                           # request + response shapes
    │   ├── application/                   # use cases (orchestration)
    │   ├── domain/                        # pure rules + OrderRepository port
    │   └── infrastructure/                # in-memory and postgres/ adapters
    ├── pricing/            # PricingProvider port + default adapter
    ├── market-calendar/    # MarketCalendarProvider port + weekday adapter
    ├── auth/               # AuthStrategy port, guard, strategies (none, api-key, jwt, function)
    ├── health/             # liveness + readiness
    └── metrics/            # Prometheus
test/{unit,integration}/    # 176 tests
Dockerfile, docker-compose.yml, .github/workflows/ci.yml, .env.example
docs/architecture.md        # deeper design notes (some sections predate the hardening work)
```

---

## Configuration

Everything is an environment variable with a default (full list with comments in [.env.example](.env.example)).
Invalid values stop the app at startup.

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | `production` enables the safety guard |
| `PORT` | `3000` | HTTP port |
| `LOG_LEVEL` | `info` | `fatal` … `trace`, `silent` |
| `SHARE_PRECISION` | `3` | Max decimals of share quantities (0–10) |
| `DEFAULT_PRICE` | `100` | Price when the partner sends none |
| `MARKET_TIMEZONE` | `UTC` | Timezone used to decide the weekday |
| `MAX_STORED_ORDERS` | `10000` | Memory-mode history cap |
| `STORAGE` | `memory` | `memory` or `postgres` |
| `ORDERS_DB_URL` | – | Required for `postgres` |
| `ORDERS_DB_POOL_MAX`, `…_CONNECT_TIMEOUT_MS`, `…_QUERY_TIMEOUT_MS` | `10`, `3000`, `5000` | Pool and timeouts |
| `ORDERS_DB_SSL`, `ORDERS_DB_SSL_CA` | `false`, – | TLS and optional CA bundle |
| `ORDERS_DB_CONNECT_RETRIES`, `…_RETRY_DELAY_MS` | `5`, `500` | Startup retries (delay doubles each time) |
| `ORDERS_DB_AUTO_SCHEMA` | `false` | Create the table at startup (dev only) |
| `AUTH_MODE` | `none` | `none` \| `api-key` \| `jwt` |
| `API_KEYS` | – | `key:partnerId,…` |
| `JWT_SECRET` / `JWT_ISSUER` / `JWT_AUDIENCE` | – | jwt mode (secret ≥ 32 chars) |
| `CORS_ORIGINS` | empty | Comma separated allowed browser origins |
| `TRUST_PROXY_HOPS` | `0` | Number of proxies in front of the app |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_TTL_MS` | `300` / `60000` | Requests per window per IP |
| `SWAGGER_ENABLED` | on, off in production | Serve `/docs` |
| `METRICS_ENABLED` | `true` | Serve `/api/v1/metrics` |

---

## Performance

`npm run bench` (autocannon). The numbers below were **measured before** the logging, helmet and
rate-limit changes and have not been re-run since, so treat them as an order of magnitude:

| Metric | Result (50 connections, 10 s, laptop) |
|---|---|
| Throughput | ~2,500 requests/s |
| Latency | p50 15 ms, p99 71 ms |
| Errors | 0 of 27,545 |

Why it is fast: no I/O on the request path in memory mode, timezone formatters are cached per zone,
history is capped, list responses are paginated, bodies are limited to 100 kb. Raise the rate limit
(`RATE_LIMIT_MAX`) before benchmarking from one IP.

---

## Libraries and frameworks

| Package | Why |
|---|---|
| `@nestjs/common`, `core`, `platform-express` (v11) | Framework, dependency injection, HTTP |
| `@nestjs/swagger` | OpenAPI / Swagger UI at `/docs` |
| `@nestjs/throttler` | Rate limiting |
| `class-validator`, `class-transformer` | Declarative request validation |
| `decimal.js` | Exact decimal arithmetic for money and quantities |
| `helmet` | Security headers |
| `nestjs-pino`, `pino`, `pino-http` | Structured JSON logs, request timing, correlation id |
| `prom-client` | Prometheus metrics |
| `jsonwebtoken` | JWT verification (`jwt` auth mode) |
| `pg` | PostgreSQL driver (optional `STORAGE=postgres`; no connection is opened by default) |
| `reflect-metadata`, `rxjs` | Nest runtime requirements |
| dev: `pg-mem` | In-process PostgreSQL emulator used by the tests |
| dev: `typescript`, `jest`, `ts-jest`, `supertest`, `@nestjs/testing`, `eslint`, `typescript-eslint`, `prettier`, `autocannon` | Build, tests, lint/format, load test |

NestJS 11 is used deliberately: v12 is ESM-only, which would add build/test complexity with no benefit here.

---

## Challenge requirements checklist

| PDF requirement | Where it is met |
|---|---|
| Accept portfolio + total amount, return amount and shares per stock | `POST /orders/split` |
| When to execute (markets Mon–Fri) | `schedule` in the response (`MarketCalendarProvider`) |
| Historic orders | `GET /orders`, `GET /orders/{id}` |
| Configurable decimal places for quantity | `SHARE_PRECISION` (3 today, 7 by changing one variable) |
| Fixed $100 price; partner price takes priority | `DEFAULT_PRICE`; `marketPrices` wins |
| RESTful design, BUY and SELL, different portfolios | Resource-style endpoints, `type` field, any portfolio |
| Response times in milliseconds visible in the console | One JSON log line per request with `responseTime` (ms) |
| Data must not survive restart | Default `STORAGE=memory`. (`postgres` is an optional extra and, if enabled, deliberately persists) |
| Compiles; README with run steps, examples, libraries | This file (the ANSWERS file was removed) |

---

## Open questions we would raise (and what we assumed meanwhile)

The brief is intentionally ambiguous. These are the points a developer would clarify with the
product owner before building. Until answered, the code follows the "Assumed" column, and each one
is a small, isolated change if the answer differs.

| # | Area | Question | Assumed meanwhile | If the answer differs |
|---|---|---|---|---|
| 1 | Weights | Are weights percentages (60 = 60%) or fractions (0.6)? Must they sum to exactly 100, or is a tolerance allowed? | Percentages, exactly 100 | Change `portfolio.validator.ts` only |
| 2 | Input | Does the partner send the portfolio on every call, or do we store model portfolios and receive a portfolio id? | Sent in every request | Add a `PortfolioProvider` port; the use case asks it for holdings |
| 3 | Rounding | Round shares down, nearest, or up? Is a leftover (unused cash) acceptable, and who keeps it? | Round down; the leftover is reported as `unusedAmount` | One line in `quantity-calculator.service.ts` |
| 4 | Precision | Is the 3 → 7 decimal change a global setting, or per partner or per stock? Do fractional shares apply to every stock? | One global setting (`SHARE_PRECISION`) | Move the value into a per-partner provider |
| 5 | Price | Is the $100 price a placeholder for a real feed later? How old may a price be? What if the partner price is zero or missing for one stock? | Placeholder, configurable; partner price wins per stock; ≤ 0 is rejected | New `PricingProvider` (live feed, staleness rule) |
| 6 | Price | Is the "price at time of purchase" the price at request time or at execution time? | Request time (the partner passes it or we use the default) | Quantities may need recomputing at execution, which implies an async flow |
| 7 | Schedule | What does "when to execute" return: a date, a date-time, or a rule? What about requests after market close, and holidays? | Date only; Mon–Fri; weekends roll to Monday; no hours or holidays | New `MarketCalendarProvider` (exchange calendar) |
| 8 | Schedule | Which timezone decides "today": the partner's, the user's, or the exchange's (e.g. New York)? | Configurable default (UTC), overridable per request | Change the `MARKET_TIMEZONE` default |
| 9 | Orders | Is a SELL checked against the user's holdings? Do we need user ids and positions? | No check; no concept of a user or positions | Needs holdings data and a new port |
| 10 | Orders | Does the API only calculate, or must it also place the orders with a broker? Is the response a quote or a commitment? | Calculate only; status `CALCULATED` | Add an order status workflow and a broker adapter |
| 11 | History | Whose history: the partner's or the end user's? Is filtering by date, symbol or type needed? How long is it kept? | Per partner; newest first; paged; no filters | Add query parameters and an index |
| 12 | History | The brief says data must not survive restart. Does that apply to production too, or is it only for the proof of concept? | Memory by default; PostgreSQL is an optional extra | Switch `STORAGE` (already built) |
| 13 | Currency | USD only, or multi-currency? Minimum order amount? Maximum? | USD only; amount > 0, 2 decimals | Add `currency` to the request and a limits rule |
| 14 | Portfolio | Are there limits on stocks per portfolio, symbol format, or a list of allowed symbols? | 1–100 stocks, 1–10 letters, no allow-list | Add an allow-list provider |
| 15 | Security | Is authentication expected? Which scheme does the partner use (API key, OAuth2, mTLS)? | Off by default; API key and JWT built in; pluggable | Implement one `AuthStrategy` |
| 16 | Reliability | Can a partner retry a failed call? Must a repeat never create a second order? | Yes, via an optional `Idempotency-Key` header | Make the header mandatory |
| 17 | Volume | Expected requests per second and number of partners? Latency target? | Unknown; one instance handles roughly 2,500 req/s in our test | Scale out, move to PostgreSQL, add a gateway |
| 18 | Contract | Required response format and naming? Do amounts have to be numbers rather than strings? Is there an existing API style guide? | Amounts and quantities are strings (no float errors); versioned under `/api/v1` | Change the response DTO mapper only |
| 19 | Observability | What does "visible in the console" mean: a log line per request, or a metric? Any logging format required? | One JSON log line per request with `responseTime` in ms, plus `/metrics` | Switch the logger output format |
| 20 | Compliance | Are there audit, retention or regulatory rules (for example MiFID, SEC) for stored orders? | None assumed | Add an audit log and retention policy |

---

## Current limitations

* Default history is in memory: lost on restart, not shared between instances.
* The PostgreSQL adapter is tested on the `pg-mem` emulator, not a real server. Schema is applied by a dev flag; there is no migration tool yet.
* Rate-limit counters are per instance. `/metrics` is unauthenticated by design.
* No trading hours, holidays or exchange calendars; no broker integration; prices come from the request or a default, not a feed.
* SELL does not check holdings (the brief has no positions concept).
* `docs/architecture.md` and `.env.connections.example` describe the earlier design and have not been updated for the production changes.

See [docs/architecture.md](docs/architecture.md) for deeper design notes.
