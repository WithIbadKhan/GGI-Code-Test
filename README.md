# Secure AI Chat Backend

A backend for an AI chat product with monthly quotas and paid subscription bundles.

It is written in TypeScript with Express and PostgreSQL, and follows Domain-Driven Design. Security comes first: every endpoint needs a verified access token from an external identity provider, and every API request must also be signed.

The original brief is in `GGI - BACKEND TEST POSTURE (1) (1) (1).pdf` in this repository.

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Setup](#setup)
- [Using the API](#using-the-api)
- [Architecture](#architecture)
- [Security model](#security-model)
- [Testing](#testing)
- [Configuration](#configuration)
- [Known limitations](#known-limitations)

## Features

- **AI chat.** Ask a question and get an AI answer. The question, answer, token usage and request details are stored.
- **Quota.** 3 free messages per user per month. After that, a subscription bundle is needed.
- **Subscriptions.** Basic, Pro and Enterprise plans, billed monthly or yearly, with auto-renew and cancellation.
- **Billing simulation.** Automatic renewals and payments, with random payment failures.
- **Security.** External login (OIDC), signed requests, role-based access, rate limiting, input validation.
- **Operations.** Structured logs, a health check and an admin metrics endpoint.

## Tech stack

- Node.js 22+, TypeScript in strict mode, Express 5
- PostgreSQL with plain SQL (`pg`) and migrations (`node-pg-migrate`)
- Zod for validation, jose for token verification, pino for logging
- Vitest and Supertest for tests, ESLint and Prettier for code style

I used plain SQL instead of an ORM on purpose. The quota and billing logic depends on locks and guarded updates, and that SQL should be easy to see and review.

## Setup

You need Node.js 22 or newer, and PostgreSQL 14 or newer (or Docker).

**1. Install and configure**

```bash
npm install
cp .env.example .env
```

Then open `.env` and set `SESSION_SIGNING_SECRET` and `HEALTH_CHECK_TOKEN` to random values. You can generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**2. Create the database**

With Docker:

```bash
docker compose up -d
```

Or with an existing PostgreSQL. Run this as a superuser, and change the port in `.env` if yours is not 5432:

```sql
CREATE ROLE ggi LOGIN PASSWORD 'ggi_local_password';
CREATE DATABASE ggi OWNER ggi;
CREATE DATABASE ggi_test OWNER ggi;
```

**3. Create the tables**

```bash
npm run migrate
```

**4. Start the app**

Use two terminals:

```bash
npm run dev:idp    # local identity provider on port 4000
npm run dev        # API on port 3000
```

For local development, `.env` must point at the local identity provider:

```
AUTH_ISSUER=http://localhost:4000/
AUTH_JWKS_URI=http://localhost:4000/.well-known/jwks.json
```

### The local identity provider

`scripts/dev-idp.ts` stands in for a real provider such as Auth0 or Keycloak. It publishes a public key set (JWKS) and issues signed tokens. The API checks these tokens with the same code it uses in production.

It is a development tool only:

- It listens on localhost only.
- It refuses to run when `NODE_ENV=production`.
- The API refuses to start in production if the login provider does not use `https`.

To use a real provider, change `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URI` and `AUTH_ROLES_CLAIM` in `.env`. No code changes are needed.

### AI provider

By default the app uses a **mocked OpenAI provider**, as the brief asks. It waits a random time and returns an answer in the OpenAI response format, with token counts.

A real Google Gemini provider is also included as an option. It is not required by the brief and is off by default. To use it, set in `.env`:

```
AI_PROVIDER=gemini
GEMINI_API_KEY=your-key
```

## Using the API

Every request has to be signed, so plain `curl` is not enough. The project includes a small command-line client that does the signing for you:

```bash
npm run api -- ask "What is DDD?"      # ask a question
npm run api -- usage                   # quota left this month
npm run api -- history                 # my chat messages
npm run api -- buy BASIC MONTHLY       # buy a bundle
npm run api -- subs                    # my subscriptions
npm run api -- cancel <id>             # cancel a subscription
npm run api -- usage --as bob          # act as another user
npm run api -- metrics --admin         # admin metrics
npm run api -- health                  # health check
npm run api                            # list all commands
```

### Endpoints

All routes under `/api/v1` need a bearer token **and** a request signature. The only exception is `POST /api/v1/auth/session`, which is where a client gets its signing key.

**Auth**

| Method | Path                   | Description                                            |
| ------ | ---------------------- | ------------------------------------------------------ |
| POST   | `/api/v1/auth/session` | Exchange an access token for a session and signing key |

**Chat**

| Method | Path                        | Description                                   |
| ------ | --------------------------- | --------------------------------------------- |
| POST   | `/api/v1/chat/messages`     | Ask a question. Body: `{ "question": "..." }` |
| GET    | `/api/v1/chat/messages`     | Chat history (`limit`, `offset`)              |
| GET    | `/api/v1/chat/messages/:id` | One message                                   |
| GET    | `/api/v1/chat/usage`        | Free and bundle messages left this month      |

**Subscriptions**

| Method | Path                               | Description                                                   |
| ------ | ---------------------------------- | ------------------------------------------------------------- |
| POST   | `/api/v1/subscriptions`            | Buy a bundle. Body: `{ "tier", "billingCycle", "autoRenew" }` |
| GET    | `/api/v1/subscriptions`            | My subscriptions                                              |
| GET    | `/api/v1/subscriptions/:id`        | One subscription                                              |
| PATCH  | `/api/v1/subscriptions/:id`        | Turn auto-renew on or off. Body: `{ "autoRenew": false }`     |
| POST   | `/api/v1/subscriptions/:id/cancel` | Cancel                                                        |

**Admin and monitoring**

| Method | Path                    | Description                                        |
| ------ | ----------------------- | -------------------------------------------------- |
| GET    | `/api/v1/admin/metrics` | Admin only. Usage and subscriptions this month     |
| GET    | `/health`               | Database status. Needs the `X-Health-Token` header |

Admins can pass `userId` to the list endpoints to see another user's data.

### Errors

Every error has the same shape:

```json
{
  "error": {
    "code": "QUOTA_EXHAUSTED",
    "message": "Your free messages for this month are used up. Subscribe to a bundle to keep chatting.",
    "details": { "reason": "SUBSCRIPTION_REQUIRED", "freeLimit": 3, "freeUsed": 3 },
    "requestId": "c5c56b33-faac-49e8-a765-29c012ace004"
  }
}
```

| Status | Meaning                                                 |
| ------ | ------------------------------------------------------- |
| 400    | Invalid input                                           |
| 401    | Missing or invalid token or signature                   |
| 402    | Quota used up, or payment declined                      |
| 403    | Not allowed for your role                               |
| 404    | Not found (also used for other users' data)             |
| 409    | Not allowed in the current state, e.g. cancelling twice |
| 413    | Request body too large                                  |
| 415    | Body is not JSON                                        |
| 429    | Rate limit reached                                      |
| 503    | AI provider unavailable, or the request took too long   |
| 504    | AI provider timed out                                   |

## Architecture

```
src/
  modules/
    chat/                 AI chat and quota
    subscriptions/        plans, purchase, renewal, billing
    auth/                 signed sessions on top of the access token
    admin/                metrics
  shared/                 token checks, request signing, HTTP middleware, errors, logging
  config/                 environment validation
  app.ts                  Express setup
  server.ts               wires everything together and starts the server
```

Each module has the same layers:

```
domain/entities/          business objects and their rules
domain/services/          use cases
domain/policies/          who is allowed to do what
domain/ports/             interfaces to the outside world (database, AI, payments)
repositories/             PostgreSQL implementations of those interfaces
infrastructure/           other implementations (AI providers, payment simulator, jobs)
controllers/              HTTP routes, input schemas, response mapping
```

**The domain does not depend on frameworks.** Code in `domain/` never imports Express, `pg`, Zod or the Gemini SDK. ESLint enforces this, so breaking the rule fails the lint step.

### Quota rules

The rules live in `QuotaCalculator`, a pure class with no database access, so they are easy to test.

1. Free messages are used first: 3 per calendar month (UTC).
2. Then the most recently purchased active bundle that still has messages left is used. Enterprise bundles are unlimited. The brief says "the bundle with the latest remaining quota", and this is how I read it.
3. If nothing is left, the request fails with `QUOTA_EXHAUSTED`.

The free quota resets on the 1st without a cron job. Usage is stored per user per month, so a new month simply starts with no usage. Old months stay as history.

### How a question is handled

1. **Reserve.** In a short transaction, the app locks the user, decides where the quota comes from, deducts it, and saves the message as `RESERVED`.
2. **Ask the AI.** No transaction is open, because the AI can take several seconds.
3. **Finish.** On success, the answer and token usage are saved and the message becomes `COMPLETED`. On failure, the quota is refunded and the message becomes `FAILED`.

### Concurrency

Quota must never be spent twice, even when many requests arrive at once:

- **Per-user lock.** Each reservation takes a PostgreSQL advisory lock on the user id. A row lock is not enough, because on a user's first message of the month there is no row to lock yet.
- **Guarded updates.** Bundle updates only succeed while messages are left (`WHERE used_messages < max_messages`).
- **Database constraint.** A `CHECK` constraint forbids going over the limit.

A test sends 10 requests at the same time for a user with 3 free messages, and checks that exactly 3 succeed. I also removed the lock temporarily and confirmed the test fails.

### Subscriptions

| Plan       | Monthly              | Yearly                  |
| ---------- | -------------------- | ----------------------- |
| Basic      | 10 messages, $9.99   | 120 messages, $99.90    |
| Pro        | 100 messages, $29.99 | 1,200 messages, $299.90 |
| Enterprise | unlimited, $99.99    | unlimited, $999.90      |

- **Quota per cycle.** The message limit applies to each billing cycle and resets on renewal. Yearly plans get 12 months of messages for the price of 10.
- **Server-side prices.** Prices and limits always come from the server. A request that tries to set them is rejected.
- **Tiers and cycles.** Buy with a `tier` of `BASIC`, `PRO` or `ENTERPRISE` and a `billingCycle` of `MONTHLY` or `YEARLY`.
- **Purchase.** The simulated payment is charged right away. If it is declined, the subscription is saved as `INACTIVE`, and the API returns `402 PAYMENT_FAILED`.
- **Renewal.** When a cycle ends and auto-renew is on, the subscription is charged again. Success starts a new cycle. Failure makes it `INACTIVE`. With auto-renew off, it just becomes `INACTIVE`.
- **Cancellation.** The current cycle ends immediately, auto-renew is turned off, and nothing is deleted. Chat history stays linked to the subscription.
- **Payments.** A simulator declines about 10% of charges at random (`PAYMENT_FAILURE_RATE`).

**Billing job.** A background job runs every minute and handles subscriptions whose cycle has ended. Each one is locked with `SELECT ... FOR UPDATE SKIP LOCKED`, so even with several servers running, every subscription is charged only once per cycle. A test runs three billing workers at the same time to prove this.

## Security model

### Login

The app never stores passwords or creates tokens. Users log in with an external OIDC provider, and the API checks every access token against the provider's public keys. It verifies the signature, issuer, audience, expiry and user id. Only asymmetric algorithms are accepted, so a token signed with a guessed shared secret is rejected.

### A token alone is not enough

As the brief requires, the API does not trust an access token on its own. It combines three protections:

1. **Session bound to the token.** The client sends its token to `POST /api/v1/auth/session` and gets back a session id and a signing key. The session only works with that exact token, for that user. It ends when the token expires, after one hour at most.
2. **Signed requests.** Every other request must include four headers: `X-Session-Id`, `X-Timestamp`, `X-Nonce` and `X-Signature`. The signature is an HMAC-SHA256, made with the session key, over this text:

   ```
   METHOD
   PATH?QUERY
   TIMESTAMP
   NONCE
   SHA256 OF THE BODY
   ```

3. **Timestamp and nonce.** The timestamp must be within 2 minutes of the server time. Each nonce can be used only once.

What this means in practice:

- A stolen token cannot call the API without the session key.
- A recorded request cannot be replayed.
- A request cannot be changed without breaking the signature.

Signing keys are never stored. They are calculated from a server secret, so a leaked database does not expose them. The protocol is described in `src/shared/security/requestSigning.ts`, and `scripts/api.ts` is a working client.

### Access control

Access is checked twice:

- **In the routes.** Each route requires the `user` or `admin` role.
- **In the domain.** Policy classes check again inside every use case.

Users can only see and change their own messages, usage and subscriptions. Admins can see everything, and only admins can read metrics. Asking for another user's message or subscription returns `404`, so ids cannot be guessed.

### Request protection

- Secure HTTP headers (Helmet), and the `X-Powered-By` header is removed.
- CORS only allows the origins listed in `CORS_ORIGINS`.
- Request bodies are limited to 16 KB and must be JSON.
- A global request timeout, plus separate timeouts for the AI call and the database.
- Rate limits per IP address and per user. Auth, chat, subscription and admin routes each have their own limits, and auth is the strictest.
- `/health` is not public either. It needs a monitoring token in the `X-Health-Token` header.

### Input and output

- All input is checked with strict schemas. Unknown fields are rejected, which prevents mass assignment.
- HTML and control characters are removed from questions and AI answers. AI output is treated as untrusted too.
- All SQL uses parameters, never string building.
- Responses list their fields explicitly, so internal data never leaks.
- Error responses never include stack traces or internal messages. Those go to the logs only.

### Operations

- Settings are checked at startup, and the app will not start with missing or unsafe values.
- Secrets live only in `.env`, which is not committed.
- Logs are JSON and include the request id, user id and response time. Tokens and cookies are hidden in the logs.

## Testing

```bash
npm run test:unit          # business logic, no database needed
npm run test:integration   # HTTP and real PostgreSQL (uses TEST_DATABASE_URL)
npm run check              # type check, lint, format check and all tests
```

There are 166 tests.

**Continuous integration.** GitHub Actions (`.github/workflows/ci.yml`) runs the type check, ESLint, the Prettier check and all tests against a real PostgreSQL on every push and pull request. Code that is badly formatted, breaks a lint rule or fails a test cannot pass CI.

**Unit tests** cover:

- quota rules and the month boundary
- the chat message lifecycle
- plan prices and billing dates (month ends, leap years)
- the full subscription lifecycle
- sessions and request signing

**Integration tests** run against a real database. They cover:

- login and token checks
- signed requests
- rate limits
- security headers and CORS
- input validation and sanitization
- timeouts
- health and metrics
- concurrency for quota and billing

**Login is mocked, not bypassed.** The tests create a real key pair and sign real tokens, and the app verifies them with its production code.

**The security tests catch real regressions.** For each key protection (quota lock, billing lock, replay check, signature check), I switched it off once and confirmed the matching test fails.

The integration tests reset the test database on each run. For safety, they refuse to run against a database whose name does not contain `test`.

## Configuration

All settings come from environment variables. See `.env.example` for the full list with comments. The main ones:

| Variable                                        | Purpose                                 |
| ----------------------------------------------- | --------------------------------------- |
| `DATABASE_URL`, `TEST_DATABASE_URL`             | Database connections                    |
| `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URI` | Identity provider                       |
| `AUTH_ROLES_CLAIM`                              | Token claim that holds the user's roles |
| `SESSION_SIGNING_SECRET`                        | Server secret for request signing       |
| `HEALTH_CHECK_TOKEN`                            | Token for the health check              |
| `AI_PROVIDER`, `GEMINI_API_KEY`                 | `mock` (default) or `gemini`            |
| `FREE_MESSAGES_PER_MONTH`                       | Free quota, 3 by default                |
| `PAYMENT_FAILURE_RATE`                          | Share of simulated payments that fail   |
| `BILLING_INTERVAL_MS`                           | How often the renewal job runs          |
| `*_RATE_LIMIT_PER_IP`, `*_RATE_LIMIT_PER_USER`  | Rate limits for each route group        |
| `CORS_ORIGINS`                                  | Allowed browser origins                 |

## Known limitations

- **Rate limits are in memory.** That is fine for one server. With several servers, the counters should move to a shared store such as Redis.
- **Stored text is HTML-escaped.** For example, `a < b` is stored as `a &lt; b`. That is safe, but a client showing it as plain text has to decode it.
- **A crash can leave a message `RESERVED`.** If the server stops while waiting for the AI, that message keeps its quota. A cleanup job could refund old reservations.
- **Purchases are not idempotent.** If a client retries a purchase after a network error, it could buy twice. An `Idempotency-Key` header would fix this.
- **Each signed request writes one nonce to the database.** At high volume, nonces would move to Redis.
- **Cancelling during a chat request can return 409.** If a user cancels a bundle while a chat request is charging it, that request fails with `409` and nothing is overcharged. The client can simply retry.
