# WisTally ERP

An ERP for small and mid-sized trading and distribution companies: purchasing, sales, inventory,
receivables and payables, and a real general ledger.

Monorepo · trunk-based development · TypeScript end to end.

## Status

**M0 — Foundation.** The engineering scaffolding is in place and the vertical slice below works:

- session authentication (httpOnly cookie, argon2id, CSRF double-submit)
- three-layer permission model, function-level enforcement wired end to end
- company / warehouse / fiscal period organization data, tenant-scoped by `company_id`
- customer and supplier master data sharing one record, with contacts, addresses and credit limits
- append-only audit log written inside the same transaction as the change
- gapless document numbering service
- in-database job queue with a scheduled maintenance job

Business modules (purchasing, sales, inventory, accounting) are M2–M5; M1 (master data and
inventory) is in progress. See [docs/08-roadmap.md](docs/08-roadmap.md).

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 22 or newer |
| pnpm | 11 (`corepack enable && corepack prepare pnpm@11.18.0 --activate`) |
| Docker | optional, for local MySQL and MinIO |

## Quick start

```bash
pnpm install

# 1. Start MySQL (and MinIO, unused in M0)
docker compose -f deploy/docker-compose.dev.yml up -d mysql

# 2. Create the schema and the initial books
pnpm db:migrate
pnpm db:seed

# 3. Run api (3000), worker and web (5173) together
pnpm dev
```

Open <http://localhost:5173> and sign in with the seeded administrator:

```
admin@wistally.local / Admin@123456
```

The Vite dev server proxies `/api` to `http://localhost:3000`, so cookies stay same-origin.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Run api, worker and web with hot reload |
| `pnpm build` | Build every package and app |
| `pnpm verify` | lint + typecheck + dependency boundaries + unit tests |
| `pnpm test` | Unit tests |
| `pnpm depcruise` | Enforce module boundaries |
| `pnpm db:generate` | Generate SQL from the Drizzle schema (review before committing) |
| `pnpm db:migrate` | Apply pending migrations under an advisory lock |
| `pnpm db:seed` | Create the demo company, roles, admin user and fiscal periods (idempotent) |

## Layout

```
apps/
  api/        NestJS + Fastify HTTP service
  worker/     background job consumer
  web/        React + Vite SPA
packages/
  kernel/     Money, Quantity, Result, Clock, UnitOfWork (zero IO)
  domain/     Aggregates, ports, permission catalogue (zero IO)
  application/ Use cases: login, authenticate, warehouses
  contracts/  zod schemas and DTOs shared by web and api
  db/         Drizzle schema, migrations, repositories, seed
  config/     Shared tsconfig presets
docs/         Design and engineering documentation
deploy/       Compose files
```

Dependency direction is enforced in CI: `kernel ← domain ← application ← api/worker`, and
`application` may never import `db`. Use cases see ports, not the database.

## Documentation

Start at [docs/README.md](docs/README.md). The two documents worth reading first:

- [03 · Core business model](docs/03-core-business-model.md) — how documents, stock, journal entries and
  allocations work, including the posting rules table
- [07 · Trunk-based development](docs/07-trunk-based-development.md) — branches, PRs, CI and releases

## Conventions

- Amounts are `Money` value objects over `BigInt` at 6 decimals; the API transports them as strings.
  `number` is never used for money.
- Migrations are plain SQL, forward-only, and must run against the previously deployed application
  version (expand → contract).
- Every write emits an audit row inside the same database transaction.
- One PR = one squashed commit on `main` = one unit of rollback.

## License

Licensed under the [Apache License, Version 2.0](LICENSE). You may use, modify, and distribute this
software, including commercially, provided you keep the copyright and license notices and state
significant changes.

Distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the [LICENSE](LICENSE) file for the specific language governing permissions and limitations.
