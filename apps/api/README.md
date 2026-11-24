# SkillConnect API

The public `GET /health` endpoint returns HTTP 200 when PostgreSQL responds and 503 otherwise. With no database URL, it reports process health only. It sends a generic JSON status and no connection details. Messaging routes and `GET /api/v1/ws` require a verified service assertion. The server has no configured verifier while Google OAuth is pending, so those routes return 401. See the [REST and WebSocket contract](../../docs/api-contract.md).

## Start locally

Use Go 1.25 or later and Docker with the Compose plugin, or supply a dedicated local PostgreSQL 18 database.

For a fresh Compose database, run in PowerShell from the project root. Keep the generated development password in your local secret store and reuse it for this volume on later starts.

```powershell
$env:POSTGRES_PASSWORD = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
$env:DATABASE_URL = "postgres://skillconnect:$($env:POSTGRES_PASSWORD)@127.0.0.1:55432/skillconnect?sslmode=disable"
docker compose up -d --wait db
cd apps/api
go run ./cmd/migrate
go run ./cmd/server
```

Set `WS_ALLOWED_ORIGINS` to a comma-separated list of exact HTTP(S) origins before enabling the trusted verifier. For example, `$env:WS_ALLOWED_ORIGINS = 'http://localhost:3000'` permits that origin only for authenticated upgrade requests. The default is an empty allowlist. The hub is in memory and intended for single-instance delivery. Reconnected clients resubscribe and catch up from REST history.

The API listens on `127.0.0.1:8080` by default. In another terminal, run `curl.exe -fsS http://127.0.0.1:8080/health` and expect `{"status":"ok"}`. If using an existing local database, set `DATABASE_URL` to its connection string and run the two Go commands. Use TLS with server verification for a non-local database. The Compose port and HTTP bind address are loopback-only by default. The example environment file lists available settings. Go reads the process environment.

`go run ./cmd/migrate` applies versioned SQL from `migrations/` in filename order. The transaction locks out concurrent runners and records checksums in `schema_migrations`. A rerun applies only new files and checks previous history. Add a new numbered SQL file for each schema change. Use a database role that can run DDL for migration, and a separate least-privilege role when serving real data.

## Verify

From `apps/api`:

```powershell
go test ./...
go test -race ./...
go vet ./...
$env:TEST_DATABASE_URL = $env:DATABASE_URL
go test -count=1 -v ./...
```

Run integration tests against a **disposable development or test database**. They skip if `TEST_DATABASE_URL` is empty, create isolated schemas, and clean them up. The test role needs permission to create and drop its test schemas. Migration tests cover installation, repeat runs, rollback, checksum drift, and database constraints. REST integration tests use an injected verifier defined in test code and exercise membership, persistence, concurrent retries, and pagination against PostgreSQL.

WebSocket tests also use injected test verifiers. They cover rejected handshakes, origin checks, heartbeats, session and membership revocation, bounded queues, and graceful shutdown. With `TEST_DATABASE_URL` set, they verify committed REST-to-WebSocket delivery, retry deduplication, workspace isolation, multiple tabs, and reconnect recovery. To include PostgreSQL in the race run, set `TEST_DATABASE_URL` first and use `go test -race -count=1 ./...`. Race testing requires cgo and a compatible C compiler. On Windows, use a MinGW-w64 toolchain with runtime libraries version 8 or newer. [Go race detector requirements](https://go.dev/doc/articles/race_detector#Requirements)

## Boundaries

- `cmd/server` wires HTTP and the PostgreSQL connection pool. `internal/httpapi`, `internal/service`, and `internal/repository` separate HTTP responses, input validation, and PostgreSQL operations.
- `internal/auth` gates REST and WebSocket routes. The future verifier will resolve a trusted Next.js service assertion to an internal employee and active session. It must support session revalidation for open sockets. The messaging repository rechecks current account and membership state. See the [authentication plan](../../docs/authentication.md).
- `internal/realtime` manages subscriptions and bounded per-connection queues. The messaging service publishes newly inserted messages after commit. Only `message.created` is emitted in this increment.
- A channel has a unique name within its workspace and public or private visibility. A DM has a unique ordered pair of distinct users within its workspace. The DM and its two participant rows must be created in one transaction.
- A message references a conversation member and has a conversation-and-sender scoped client ID for retries. Attachments and read receipts can reference only messages in the same workspace and conversation. Disabled or departed membership records can remain for history. Attachment storage and read receipts have no REST endpoints in this increment.
