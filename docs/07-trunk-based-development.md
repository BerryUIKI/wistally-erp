# 07 · Trunk-based development

## 1. Why trunk-based is mandatory here

Two properties of this system make long-lived branches fail:

1. **Frontend, backend, and database changes must land in one commit.** Adding a field means changing a
   migration, the backend, the frontend, and a report. If a branch lives for two weeks, those four pieces drift.
2. **On-premises deployment means N customer instances exist simultaneously, on different versions.** Every extra
   branch multiplies the version matrix beyond control.

Trunk-based development makes one promise: **any commit on `main` can be deployed to production immediately.**
Every rule below exists to keep that promise true.

## 2. Branch model

```
main   ──●──●──●──●──●──●──●──●──●──▶   always deployable, always green
          \    /   \   /   \   /
         feat   feat  fix   chore       lifetime ≤ 2 days, deleted on merge

tag v1.2.0 ──▶ release/1.2 ──▶ cherry-picked hotfix ──▶ v1.2.1
                    (support window 3 months, then EOL)
```

### 2.1 `main`

- The only long-lived branch
- Protected: no direct pushes, no force pushes, PR required, CI required, linear history required
- Merge strategy: **squash merge**. One PR = one commit; history stays clean and rollback is PR-sized
- The PR title becomes the final commit message, following Conventional Commits

### 2.2 Feature branches

| Rule | Value |
|---|---|
| Naming | `feat/<short-description>`, `fix/<short-description>`, `chore/<short-description>` |
| Lifetime | **≤ 2 working days.** Longer means the task is too big |
| Size | **≤ 400 changed lines** (excluding migrations, lockfiles, generated code) |
| Base | Rebase onto `origin/main` at least once a day |
| After merge | Deleted automatically |

**What to do with work that takes longer than two days**: split it into independently mergeable steps. Each step
deploys; the unfinished feature hides behind a flag. This is not ceremony — it is what makes each step verifiable.

### 2.3 Release branches (the only exception)

On-premises ERP must maintain older versions for customers, so `release/x.y` branches are permitted:

| Rule | Value |
|---|---|
| Cut when | Immediately after tagging `vX.Y.Z` |
| Allowed changes | **Cherry-picks from `main` only.** Never direct commits |
| Support window | 3 months, or until the next minor ships, whichever comes first |
| End of life | Tag `vX.Y.EOL` and delete the branch |

**Iron rule: fixes land on `main` first, then get cherry-picked.** Fixing only on the release branch guarantees
the same bug reappears in the next version.

## 3. Commits and pull requests

### 3.1 Commit messages

```
<type>(<scope>): <description>

[optional body: why this change, not what it does]

[optional footer: Closes #123]
```

| type | Purpose |
|---|---|
| `feat` | New capability |
| `fix` | Bug fix |
| `refactor` | Behavior-preserving restructure |
| `perf` | Performance improvement |
| `test` | Tests only |
| `docs` | Documentation only |
| `chore` | Build, dependencies, configuration |
| `revert` | Rollback |

`scope` is the module name: `sales`, `inventory`, `accounting`, `api`, `web`, `ci`.

### 3.2 PR template

```markdown
## What changed
<!-- One sentence. If it takes more, the PR is too large. -->

## Why
<!-- Linked issue or background -->

## Impact
- [ ] Database migration (verified against expand-contract)
- [ ] API contract change (breaking? no/yes, with a compatibility plan)
- [ ] Permission points changed
- [ ] Needs a feature flag
- [ ] Changes reporting semantics

## How it was verified
<!-- What the tests cover; manual verification steps -->

## Screenshots / recording
<!-- Required for UI changes -->

## Checklist
- [ ] `pnpm verify` passes locally
- [ ] New logic has tests
- [ ] Documentation updated (required for behavior or architecture changes)
- [ ] Changeset added
```

### 3.3 Review

While there is one developer, **reviewing your own PR still matters**: reading the full diff is better than
finishing in the IDE and pushing. Rules:

- Read the complete diff before merging
- Wait for CI to be fully green
- Changes touching money math, posting rules, or permissions **must include a golden test**

Once a second person exists: respond within four hours; reviewers judge *correctness* and *maintainability*, not
style (Biome owns style).

### 3.4 Definition of Done

A PR may merge only when all of the following hold:

- [ ] `pnpm verify` passes (typecheck + lint + boundaries + unit tests)
- [ ] Integration tests pass (for anything touching the database)
- [ ] New behavior is covered by tests
- [ ] The migration can be executed by the **currently deployed version** (see §5)
- [ ] Anything touching money, postings, or permissions has a golden test
- [ ] Documentation is updated
- [ ] A changeset exists
- [ ] Incomplete features hide behind a feature flag
- [ ] New write operations emit an audit record
- [ ] New operations have permission points

## 4. CI

### 4.1 Pipeline and time budget

| Stage | Content | Budget | Consequence of failure |
|---|---|---|---|
| 1. Install | `pnpm install --frozen-lockfile` | 45 s (cached) | Block |
| 2. Static checks | lint + typecheck + boundary check | 90 s | Block |
| 3. Build | Affected-only build | 120 s | Block |
| 4. Unit tests | Affected packages | 60 s | Block |
| 5. Migration checks | Replay migrations + old-code compatibility | 120 s | Block |
| 6. Integration tests | Testcontainers + PostgreSQL | 180 s | Block |
| **Total** | | **≤ 10 minutes** | |

CI that exceeds ten minutes starts getting bypassed. E2E tests run separately (post-merge or nightly) and never
block a PR.

### 4.2 Affected-only execution

```bash
pnpm turbo run lint typecheck test build \
  --filter='...[origin/main]'
```

`...[origin/main]` means "packages changed relative to main, plus everything depending on them". Changing
`packages/domain` rebuilds every app that depends on it; changing only `apps/web` runs only the frontend.

**Risk**: the filter relies on git history. CI must check out the full history (`fetch-depth: 0`) or the
calculation is wrong.

### 4.3 Migration compatibility check (the core of trunk-based safety)

This is what makes "`main` is always deployable" real. It cannot be skipped.

```bash
# 1. Check out the previous released version
git worktree add /tmp/prev v1.2.0

# 2. Start it against the NEW migrations
pnpm --dir /tmp/prev install
pnpm --dir /tmp/prev build
psql -f migrations/*.sql          # all migrations from the new version
node /tmp/prev/apps/api/dist/main.js &   # the OLD application

# 3. Smoke test
pnpm test:smoke --base-url=http://localhost:3000
```

A failure means the migration is not backward compatible, which blocks production rollback. Rewrite it as
expand-contract.

### 4.4 Example workflow

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 5s
          --health-timeout 5s --health-retries 10
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }

      - run: pnpm install --frozen-lockfile

      - name: Boundaries and types
        run: |
          pnpm depcruise --config .dependency-cruiser.cjs packages apps
          pnpm turbo run lint typecheck --filter='...[origin/main]'

      - name: Build
        run: pnpm turbo run build --filter='...[origin/main]'

      - name: Unit tests
        run: pnpm turbo run test --filter='...[origin/main]'

      - name: Migration checks
        run: pnpm tsx scripts/check-migrations.ts

      - name: Integration tests
        run: pnpm turbo run test:integration --filter='...[origin/main]'
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/wistally_test
```

### 4.5 When `main` goes red

**Revert first, diagnose second.**

1. If the cause is not identified within 15 minutes, `git revert` the offending squash commit and push a
   `revert:` PR through the fast lane (review skipped, CI still runs).
2. Diagnose locally or on a branch; fix and merge.
3. Never "fix it directly on main", and never force push.
4. Record it under `docs/incidents/` if it was severe.

A red `main` for more than an hour means nobody can merge — the project is effectively halted. Revert rather than
gamble.

### 4.6 Flaky tests

- Quarantine on detection: tag `@flaky`, remove from the main pipeline, open an issue
- Fix or delete within 24 hours
- **"Just rerun it" is not an acceptable habit.** A rerun hides a real timing problem, and timing problems are
  exactly what an ERP fears most

## 5. Database migrations under trunk-based development

The rules are defined in [05 §10](05-data-and-tenancy.md#10-migration-rules). This section covers process.

| Rule | Reason |
|---|---|
| A migration must be executable by the **previous released version** of the application | Otherwise code cannot be rolled back |
| Breaking changes span at least three releases (expand → switch → contract) | Same |
| A merged migration file is never edited | An applied migration that changes diverges from production |
| CI replays migrations from scratch | Prevents schema drift from local manual edits |
| Migrations run automatically on startup under an advisory lock | On-premises deployments have no DBA |

**One hard line**: migrations on `main` only ever add, or add-then-remove later. Any `DROP COLUMN`, `ALTER TYPE`,
or `RENAME` may appear only after the previous version has stopped using the old shape.

## 6. Feature flags

### 6.1 Why they are required

Trunk-based development demands small commits, but features rarely finish in a day. Flags let incomplete work
land on `main` without being visible.

### 6.2 Three kinds of flags

| Kind | Purpose | Lifetime | Example |
|---|---|---|---|
| **Release flag** | Hide unfinished functionality | ≤ 30 days, deleted after rollout | `feature.multi_currency` |
| **Ops flag** | Kill a feature instantly during an incident | Permanent | `ops.disable_bulk_import` |
| **Entitlement flag** | Sell modules per customer | Permanent, tied to the license | `module.manufacturing` |

### 6.3 Rules

```ts
if (await flags.isEnabled('feature.multi_currency', { companyId })) {
  // new path
} else {
  // old path
}
```

- Flags live in the `feature_flags` table and support per-company overrides
- **Every flag has an expiry date**; CI warns when it passes
- A release flag fully rolled out must be deleted, along with the old path, within 30 days
- Never nest more than two levels (`if A { if B { if C } }` means the feature needs splitting)
- Flag reads go through a 5-minute cache, never a database round trip per request

### 6.4 Anti-patterns

| Anti-pattern | Problem |
|---|---|
| Using a flag as configuration | Flags rot; configuration does not. Long-lived settings become config |
| Writing both paths independently | Six months later nobody dares delete the old one |
| Defaulting new flags to on | New features default to off and are enabled explicitly |
| Flags without an owner | Nobody cleans them up, so they live forever |

## 7. API contract changes

Frontend and backend live in one repository and deploy together, so internal APIs **do not need version numbers**.
Two constraints apply:

1. **Frontend and backend changes ship in one PR.** "Backend merges first, frontend next week" leaves `main`
   broken in between.
2. **External APIs (phase two) are versioned** in the path (`/v2`), support N-1 for one version, with a
   three-month deprecation notice.

The one exception for internal contracts: removing a field still follows expand-contract (add new, switch both
sides, then remove old), because on-premises customers can skip versions.

## 8. Release process

```
PR merged → main
   │
   ├─▶ CI green
   │
   ├─▶ Auto-deploy to staging (on every main update)
   │      └─ smoke tests + E2E
   │
   ├─▶ Tag vX.Y.Z (human decides when)
   │      └─ build and push images (api, worker, web)
   │
   ├─▶ Deploy to production (manual, requires approval)
   │      └─ auto-migrate → health check → smoke tests
   │
   └─▶ On-premises customers: publish an upgrade package
          └─ image tags + migrations + upgrade notes + rollback plan
```

### 8.1 Rollback strategy

| Layer | Rollback? | How |
|---|---|---|
| Application code | ✅ Seconds | Switch back to the previous image tag |
| Database | ❌ **Never** | Forward-fix only |
| Data | ⚠️ Disaster only | Restore from backup (with data loss) |

**This is exactly why migrations must be backward compatible**: when code rolls back, the database is already on
the new schema, and the old code must still run.

### 8.2 Release checklist

- [ ] `main` is green and has been stable for ≥ 2 hours
- [ ] Migrations passed the compatibility check
- [ ] CHANGELOG generated and human-reviewed
- [ ] Rollback plan is explicit (which image tag, whether a data fix script is needed)
- [ ] Database backed up (mandatory before a production release)
- [ ] Someone on call (stay available for one hour after release in concurrent-use scenarios)

### 8.3 Post-release monitoring

Watch these for the first 30 minutes:

| Metric | Threshold | Action |
|---|---|---|
| 5xx rate | > 1% | Roll back immediately |
| Failed postings | 3× increase | Investigate; roll back if needed |
| p95 latency | 2× baseline | Investigate |
| Migration duration | 3× estimate | Abort and roll back |

## 9. Versioning and support policy

| Item | Policy |
|---|---|
| Version numbers | `MAJOR.MINOR.PATCH`, see [06 §9](06-monorepo.md#9-versioning) |
| Support window | Current version plus the previous minor (N-1), 3 months |
| Customer upgrades | Direct upgrade from N-2; no step-by-step version chain required |
| Database compatibility | A new version must read data written by the old one (guaranteed by the expand phase) |
| End of life | No bug fixes for EOL versions; upgrade assistance only |

**Direct N-2 upgrade is a hard constraint**: customers cannot always stop operations and may skip two versions.
That means **migrations must run consecutively**, with no "you must upgrade to X before Y" trap.

## 10. Local workflow

```bash
# 1. Branch from the latest main
git switch main && git pull --rebase
git switch -c feat/sales-credit-check

# 2. Commit in small steps (local history is squashed on merge)
git commit -m "wip: credit check skeleton"

# 3. Sync daily
git fetch origin && git rebase origin/main

# 4. Self-check before pushing
pnpm verify

# 5. Push and open a PR
git push -u origin feat/sales-credit-check

# 6. Clean up after merge
git switch main && git pull --rebase && git branch -d feat/sales-credit-check
```

**Rebase, never merge.** Feature branches keep a linear history, merges are squashed, and `main` is a straight
line. Rollback, bisect, and `git log` all become trivial.

## 11. Metrics

Even a solo developer should measure these — they only become painful at scale.

| Metric | Target | Meaning |
|---|---|---|
| Merge frequency | ≥ 1 per day | Lower means PRs are too large or the process is too heavy |
| PR lifetime | ≤ 2 days | Longer means task slicing is off |
| CI pass rate | ≥ 95% | Lower means flaky tests or insufficient local verification |
| Time to restore `main` | ≤ 1 hour | Red to green |
| Change failure rate | ≤ 15% | Releases needing rollback or hotfix |
| Migration failures | 0 | Each one is a serious incident |

**Review monthly.** When the numbers are bad, question the process before blaming people.

## 12. Anti-patterns

| Anti-pattern | Why it is dangerous |
|---|---|
| Long-lived branches (> 2 days) | Merge conflicts grow exponentially and end in a big-bang merge |
| Committing directly to `main` ("it's just one line") | Bypasses CI and breaks the always-deployable promise |
| `git push --force` to `main` | Overwrites others' work; history becomes untrustworthy |
| Merge commits | History becomes a mesh; rollback gets hard |
| Merging the backend first, frontend later | `main` is broken in between |
| Splitting a migration and its code into two PRs | No atomic rollback |
| "Ship it and see" | On-premises deployments have no canary; you cannot see |
| Disabling a failing test to make CI green | Tests lose all meaning thereafter |
| Merging unfinished work without a flag | Customers see half-built features |
| Fixing bugs only on the release branch | The bug returns in the next version |
