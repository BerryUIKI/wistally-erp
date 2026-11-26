# 06 · Monorepo engineering rules

## 1. Why a monorepo

Not because it is fashionable. Because this system has three hard requirements:

1. **One field appears in the database, the API, the form, and the report.** A change touches four places, and
   split repositories guarantee version skew. One commit can change all four, and one CI run verifies it.
2. **Frontend and backend share business rules.** How tax is computed, how amounts round, which states a
   document can be in — split repositories produce two implementations that inevitably diverge.
3. **Trunk-based development requires atomic commits.** A single business change — migration, backend, frontend,
   tests — must be **one PR, one merge, one unit of rollback**. Split repositories cannot do this.

**The cost is real**: the repository grows, CI needs incremental builds, and newcomers must understand package
boundaries. Turborepo and enforced boundary rules are cheaper than version skew.

## 2. Directory structure

```
WisTally_ERP/
├─ apps/                        # deployable units
│  ├─ api/                      # HTTP service (NestJS)
│  ├─ worker/                   # background job consumer (pg-boss)
│  └─ web/                      # SPA (React + Vite)
│
├─ packages/                    # internal libraries, never published to npm
│  ├─ kernel/                   # primitives: Money, Quantity, Result, Clock, UnitOfWork interface
│  ├─ domain/                   # domain model + port interfaces + posting rules (zero IO)
│  ├─ application/              # use-case orchestration
│  ├─ contracts/                # zod schemas, DTOs, error codes (shared by web and api)
│  ├─ db/                       # Drizzle schema, migrations, repository implementations, report SQL
│  ├─ ui/                       # design system and shared components
│  ├─ testkit/                  # test factories, ledger fixtures, golden scenarios
│  └─ config/                   # shared config (tsconfig, biome, tailwind)
│
├─ docs/
├─ scripts/                     # operational and validation scripts
├─ deploy/                      # deployment orchestration (compose, Caddy, env templates)
├─ .github/workflows/           # CI
├─ turbo.json
├─ pnpm-workspace.yaml
├─ tsconfig.json
├─ biome.json
└─ .dependency-cruiser.cjs
```

### Inside `apps/api`

```
apps/api/src/
├─ main.ts
├─ app.module.ts
├─ common/                  # guards, interceptors, exception filters, decorators, data scope
│  ├─ guards/
│  ├─ interceptors/
│  ├─ filters/
│  └─ decorators/
├─ modules/                 # one Nest module per bounded context
│  ├─ iam/
│  │  ├─ *.controller.ts
│  │  └─ iam.module.ts     # wiring only: injects db implementations into application use cases
│  ├─ org/
│  ├─ party/
│  ├─ catalog/
│  ├─ purchasing/
│  ├─ sales/
│  ├─ inventory/
│  ├─ arap/
│  ├─ accounting/
│  ├─ reporting/
│  └─ platform/
└─ bootstrap/
   ├─ migrations.ts         # run migrations on startup (advisory lock)
   └─ openapi.ts
```

**Controllers do exactly three things**: parse the request (zod) → call the use case → map the response.
**Business judgment never lives in a controller.**

### Inside `packages/domain`

```
packages/domain/src/
├─ accounting/
│  ├─ model/
│  ├─ ports/
│  ├─ services/
│  │  └─ posting-rules/     # posting-rule construction per event type
│  ├─ events.ts
│  └─ index.ts              # the only public entry point
├─ inventory/
├─ sales/
├─ purchasing/
├─ party/
├─ catalog/
├─ arap/
├─ tax/
├─ org/
├─ iam/
├─ platform/
└─ index.ts                 # exports only cross-module shared types
```

## 3. Package inventory

| Package | Responsibility | Runtime | Depends on |
|---|---|---|---|
| `@wistally/kernel` | Money, Quantity, Result, DomainError, Clock, UnitOfWork interface | Any | Nothing |
| `@wistally/domain` | Aggregates, value objects, invariants, ports, posting rules | Pure Node | kernel |
| `@wistally/application` | Use cases, transaction orchestration, authorization orchestration | Node | kernel, domain, contracts |
| `@wistally/contracts` | zod schemas, DTOs, error codes, enum literals | Any | kernel |
| `@wistally/db` | Drizzle schema, migrations, repository implementations, queries | Node + PG | kernel, domain |
| `@wistally/ui` | Components, styles, tables, form controls | Browser | React only |
| `@wistally/testkit` | Test factories, ledger fixtures, golden data | Node | kernel, domain |
| `@wistally/config` | tsconfig, biome, tailwind, vite presets | Build time | Nothing |

**Create a new package only when** it needs independent deployment, an independent release cadence, or is
consumed outside this repository. **Otherwise put the code in an existing package.** The build and cognitive
cost of twenty packages far exceeds the tidiness they appear to provide.

## 4. Dependency matrix (enforced)

Rows = who; columns = who they may depend on.

|  | kernel | domain | application | contracts | db | ui | testkit | config |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **kernel** | — | | | | | | | |
| **domain** | ✅ | — | | | | | | |
| **application** | ✅ | ✅ | — | ✅ | ❌ | | | |
| **contracts** | ✅ | ❌ | | — | | | | |
| **db** | ✅ | ✅ | ❌ | | — | | | ✅ |
| **ui** | | | | | | — | | ✅ |
| **apps/api** | ✅ | ✅ | ✅ | ✅ | ✅ | | ✅ | ✅ |
| **apps/worker** | ✅ | ✅ | ✅ | | ✅ | | ✅ | ✅ |
| **apps/web** | | | | ✅ | ❌ | ✅ | | ✅ |

**The three ❌ marks matter most:**

1. `application` must not depend on `db`: use cases know ports, not databases. This keeps use cases testable
   with in-memory implementations.
2. `contracts` must not depend on `domain`: the API contract cannot leak internal domain structures, or changing
   an aggregate breaks the API.
3. `web` must not depend on `db`: the frontend never talks to the database and never imports a Node-only package.

## 5. Enforcing boundaries

Discipline alone will rot. Three layers of defense:

### 5.1 `exports` blocks deep imports

```json
{
  "name": "@wistally/domain",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

Only the root entry is exported. `import { X } from '@wistally/domain/src/sales/model/sales-order'` fails to
resolve. Both Node and TypeScript (`moduleResolution: "bundler"`) honor this.

### 5.2 dependency-cruiser enforces layering

```js
// .dependency-cruiser.cjs
module.exports = {
  forbidden: [
    {
      name: 'kernel-pure',
      severity: 'error',
      comment: 'kernel depends on nothing',
      from: { path: '^packages/kernel/' },
      to: { pathNot: '^packages/kernel/' },
    },
    {
      name: 'domain-pure',
      severity: 'error',
      comment: 'the domain layer touches no IO and no upper layer',
      from: { path: '^packages/domain/' },
      to: { path: '^(packages/(application|db)|apps/)' },
    },
    {
      name: 'domain-no-io-libs',
      severity: 'error',
      comment: 'the domain layer imports no database, HTTP, or framework packages',
      from: { path: '^packages/domain/' },
      to: { dependencyTypes: ['npm'], path: '^(drizzle-orm|pg|@nestjs|fastify|axios|ioredis)' },
    },
    {
      name: 'application-no-infra',
      severity: 'error',
      from: { path: '^packages/application/' },
      to: { path: '^packages/db/' },
    },
    {
      name: 'apps-isolated',
      severity: 'error',
      comment: 'apps never depend on each other',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/[^/]+/', pathNot: '^apps/$1/' },
    },
    {
      name: 'domain-cross-module-via-index',
      severity: 'error',
      comment: 'domain modules interact only through the other module index.ts',
      from: { path: '^packages/domain/src/([^/]+)/' },
      to: {
        path: '^packages/domain/src/(?!$1/)([^/]+)/',
        pathNot: '^packages/domain/src/[^/]+/index\\.ts$',
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
};
```

### 5.3 CI runs it on every PR

```bash
pnpm depcruise --config .dependency-cruiser.cjs packages apps
```

**A broken boundary turns CI red and the PR cannot merge.** No exceptions, no `// eslint-disable`.

## 6. TypeScript configuration

The root `tsconfig.json` only references projects; it compiles nothing:

```json
{
  "files": [],
  "references": [
    { "path": "packages/kernel" },
    { "path": "packages/domain" },
    { "path": "packages/application" },
    { "path": "packages/contracts" },
    { "path": "packages/db" },
    { "path": "apps/api" },
    { "path": "apps/worker" }
  ]
}
```

`packages/config/tsconfig.base.json` fixes the settings:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "declaration": true,
    "composite": true,
    "skipLibCheck": true
  }
}
```

**Every strict flag is on.** In a financial system, one `undefined` is one wrong entry. There is no justification
for disabling any of them.

**No path aliases** (`@/` and friends). The package name is the import path; `workspace:*` makes internal
packages look exactly like npm packages. Aliases hide the dependency graph, and visibility is precisely what a
monorepo must preserve.

## 7. Turborepo

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "lint": { "outputs": [] },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "test:integration": {
      "dependsOn": ["^build"],
      "cache": false,
      "outputs": []
    },
    "dev": { "cache": false, "persistent": true }
  }
}
```

**Caching policy**

| Task | Cacheable | Reason |
|---|---|---|
| `build` | ✅ | Stable input hashing |
| `typecheck` | ✅ | Same |
| `lint` | ✅ | Same |
| `test` (unit) | ✅ | Pure functions |
| `test:integration` | ❌ | Depends on a real PostgreSQL instance |
| `e2e` | ❌ | Same |
| `dev` | ❌ | Long-running process |

**Remote cache**: not in the MVP (single developer, low payoff). Add Vercel Remote Cache or self-hosted once the
team exceeds two people.

## 8. Build and artifacts

| Package | Build tool | Output | Entry |
|---|---|---|---|
| `kernel` / `domain` / `application` / `contracts` | `tsc --build` | `dist/**` (JS + d.ts) | Root `exports` |
| `db` | `tsc --build` + drizzle-kit | `dist/**` + `drizzle/*.sql` | Same |
| `ui` | `tsc --build` | `dist/**` | Same |
| `apps/api` | `tsc` | `dist/main.js` | `node dist/main.js` |
| `apps/worker` | `tsc` | `dist/main.js` | `node dist/main.js` |
| `apps/web` | Vite | `dist/**` (static) | Served directly by Caddy |

**No bundling of internal packages with `tsup` or `esbuild`.** They are consumed only inside the monorepo, and
plain `tsc` output is the most debuggable: readable stacks, accurate source maps. Deployment images use
`pnpm deploy --prod` to produce a pruned `node_modules`.

`dist` is never committed or cached in the repository. CI relies on Turbo cache.

## 9. Versioning

Every package is `private: true` and **never published to npm**. The product still needs a version.

Use [changesets](https://github.com/changesets/changesets):

```json
{
  "privatePackages": { "version": true, "tag": true },
  "commit": false,
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "patch"
}
```

- Every user-visible PR includes a changeset file with one plain-language sentence.
- `pnpm changeset version` aggregates them into `CHANGELOG.md` and bumps the version.
- **Internal packages share one version and are never versioned independently.** They always deploy together, so
  independent versions would only create a meaningless matrix.

Product version semantics:

| Change | Version |
|---|---|
| A breaking expand-contract schema change | Major |
| New backward-compatible feature | Minor |
| Bug fix | Patch |

## 10. Shared config package

`packages/config` holds everything that would otherwise be copied into every package:

```
packages/config/
├─ tsconfig.base.json
├─ tsconfig.node.json
├─ tsconfig.react.json
├─ biome.json
├─ tailwind.preset.ts
└─ vite.preset.ts
```

Packages declare only their differences:

```json
{ "extends": "@wistally/config/tsconfig.node.json", "compilerOptions": { "outDir": "dist" } }
```

**Never copy the same configuration into multiple packages.** Configuration drift is the most insidious technical
debt — six months later you discover one package never had `strict` enabled, and it is the one computing money.

## 11. Contracts and code generation

**`packages/contracts` is the single source of truth for the API.**

```ts
// packages/contracts/src/sales/sales-invoice.ts
export const salesInvoiceLineSchema = z.object({
  itemId: z.uuid(),
  quantity: z.string().regex(/^\d+(\.\d{1,6})?$/),   // strings, never numbers
  unitPrice: z.string().regex(/^\d+(\.\d{1,6})?$/),
  taxCodeId: z.uuid(),
});

export const postSalesInvoiceRequestSchema = z.object({
  version: z.number().int().positive(),
});
```

- The backend validates requests with the same schema.
- The frontend validates forms with the same schema.
- **Amounts and quantities travel as strings, never as JSON numbers.** `JSON.parse` turns `0.1 + 0.2` into
  `0.30000000000000004` and cannot reliably represent six decimals.

**OpenAPI**: `apps/api` generates the OpenAPI document from Nest metadata at startup, for external integrators
(phase two). **There is no reverse type generation for the frontend** — it imports contracts directly. Types are
a compile-time artifact, so no code generation step is needed.

## 12. Adding a module

Follow the order. Every step leaves the tree compiling. **Do not write everything and then run it once.**

- [ ] Add any needed value objects to `packages/kernel`
- [ ] Create `packages/domain/src/<module>/` with `model/`, `ports/`, `index.ts`
- [ ] Write the aggregates and invariants with unit tests (no database yet)
- [ ] Add zod schemas and DTOs under `packages/contracts/src/<module>/`
- [ ] Add tables in `packages/db/src/schema/<module>.ts` and port implementations in
      `packages/db/src/repositories/<module>.ts`
- [ ] Generate and **manually review** the migration SQL
- [ ] Write use cases in `packages/application/src/<module>/`
- [ ] Add controllers and module wiring in `apps/api/src/modules/<module>/`
- [ ] Register permission points in `packages/db/src/seed/05-permissions.ts`
- [ ] Add routes and menu entries under `apps/web/src/routes/`
- [ ] Write integration tests (Testcontainers + real PostgreSQL)
- [ ] Update the context inventory in `docs/02-domain-model.md`
- [ ] Add a changeset

**A module is "done"** when `pnpm verify` passes (typecheck + lint + boundaries + unit + integration) and it
appears in the documentation's context inventory.

## 13. Local development

```bash
pnpm install
docker compose -f deploy/docker-compose.dev.yml up -d   # PostgreSQL + MinIO
pnpm db:migrate
pnpm db:seed
pnpm dev                                                # turbo runs api / worker / web in parallel
```

| Command | Purpose |
|---|---|
| `pnpm dev` | Run all three apps with hot reload |
| `pnpm build` | Full build (Turbo cached) |
| `pnpm verify` | typecheck + lint + boundaries + unit tests (must be green before pushing) |
| `pnpm test:integration` | Integration tests against a throwaway PostgreSQL container |
| `pnpm test:e2e` | Playwright |
| `pnpm db:generate` | Generate migration SQL from the schema (must be reviewed by a human) |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Load the initial books |
| `pnpm changeset` | Record a change note |

`pnpm verify` is the gate before pushing, wired into Lefthook's `pre-push`. `pre-commit` only runs lint-staged
(fast), never the full suite.

## 14. Common mistakes

| Mistake | Consequence | Correct approach |
|---|---|---|
| `import { db }` inside `domain` | Domain logic can't be unit tested without a database | Define a port; implement it in `db` |
| Querying `inventory_balances` directly from `sales` | Inventory rules bypassed; books diverge from stock | Call `InventoryPort` |
| `import type { SalesOrder } from '@wistally/domain'` in `contracts` | Any aggregate change breaks the API | Define DTOs independently in `contracts` |
| Frontend hand-building `fetch` URLs | Lost types, inconsistent error handling | Use the shared `apiClient` and query hooks |
| Adding a 30-line package | More build graph, more CI | Put it in an existing package |
| Passing money as `number` from API to UI | Precision loss, unexplained one-cent differences | Strings in transport, parsed by `Money` |
| Generating migrations with `drizzle-kit push` | Production schema changes silently | `generate` only, with human review |
| Cross-module business orchestration inside an app | Use cases scattered, untestable | Put it in `packages/application` |
