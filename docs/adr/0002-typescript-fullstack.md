# ADR-0002: TypeScript across the stack

- **Status**: Accepted
- **Date**: 2026-11-26
- **Deciders**: Project owner

## Context

A primary language must be chosen from .NET, Java, and TypeScript. Constraints:

- One developer, three to four months to an MVP
- A monorepo is mandatory, with shared business rules between backend and frontend
- Monetary arithmetic must be exact
- On-premises deployment; no reliance on managed cloud services

## Decision

TypeScript across the stack:

| Layer | Choice |
|---|---|
| Runtime | Node.js 22 LTS |
| Backend framework | NestJS with the Fastify adapter |
| Frontend | React 19 + Vite + TanStack Router/Query/Table |
| Data access | Drizzle ORM |
| Validation and contracts | zod |
| Build orchestration | pnpm + Turborepo |

## Rationale

1. **Seventy percent of ERP effort is UI.** Tables, forms, bulk operations, print previews, keyboard-driven data
   entry — the TypeScript ecosystem's maturity and velocity here are decisive.
2. **The best monorepo tooling.** pnpm workspaces + Turborepo + changesets is a proven combination. Gradle
   multi-module and .NET solutions can do it, but caching, incrementality, and task graphs are clearly weaker.
3. **One definition, four consumers.** A single zod schema serves backend request validation, frontend form
   validation, API documentation, and test data. Renaming a field fails at compile time instead of at runtime.
4. **Cognitive load for a solo team.** One language, one standard library, one debugger.

## Consequences

### Positive

- Shared types between frontend and backend; contract mismatches surface at compile time
- Safe refactoring: the IDE reliably renames symbols across packages
- A broader hiring pool later

### Negative (must be taken seriously)

1. **`number` is IEEE 754 double precision** and cannot represent every decimal fraction
2. **Types do not exist at runtime**; JSON arrives as `any`
3. **Single-threaded**; CPU-bound work blocks the event loop
4. **Finance-domain talent defaults to trusting .NET or Java `decimal`**

### Mitigation

| Risk | Measure |
|---|---|
| Monetary precision | `Money` value object backed by `BigInt` at 6 decimals; ESLint forbids bare `number` in money math; `NUMERIC(19,6)` in the database; strings in transport |
| Runtime types | Every external input (HTTP, Excel, webhooks, environment variables) parsed with zod at the boundary; only parsed types trusted internally |
| CPU-bound work | Report aggregation pushed into SQL; PDF rendering and bulk exports run in the `worker` process |
| Domain trust | Posting rules covered by golden tests down to the last cent; core algorithms cross-checked against hand calculations |

## Alternatives considered

| Option | Pros | Why not chosen |
|---|---|---|
| .NET (ASP.NET Core + EF Core) | Native `decimal`; the mainstream choice for financial ERP; friendly Windows on-premises story | The frontend is still TypeScript, so shared types require code generation; weaker monorepo tooling; no existing .NET experience on the team |
| Java (Spring Boot) | Huge ecosystem, enterprise standard | Also requires generated shared types; JVM memory footprint is unfriendly to single-machine on-premises installs; slower iteration |
| TypeScript plus Rust/Go core services | Exact money math in a strict language | Splitting cost far exceeds the benefit; `BigInt` is already exact |

## Re-evaluation triggers

- A computation becomes an irreducible bottleneck (for example large-scale MRP) and can be isolated as a
  Rust/Go module
- The team becomes .NET-centric; rewriting the backend is then cheaper than retraining everyone

## Related

- [ADR-0007: Money representation](0007-money-representation.md)
