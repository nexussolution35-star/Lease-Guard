# Repository migration plan and log

Migration of LeaseGuard from a single Vite package to the approved pnpm monorepo
(frontend, backend, python-services, packages, supabase, infrastructure). Revised 7 November 2026
after review. Work happens on branch `migration/monorepo`.

## Audit results (measured)

### Component inventory before migration

Counted on the filesystem. "Components" are non-test `.tsx` files exporting components.

| Directory | Components | Helper `.ts` | Test helpers | Tests | Notes |
| --- | --- | --- | --- | --- | --- |
| `components/ui` | 35 | 0 | 0 | 0 | shadcn/ui primitives |
| `components/shared` | 34 | 3 | 0 | 7 | 33 specified plus `AppLink` |
| `components/forms` | 17 | 9 | 1 (`testHarness.tsx`) | 7 | 15 specified plus `FieldMessage`, `RequiredIndicator` |
| `components/layout` | 20 | 2 | 1 (`testRouter.tsx`) | 2 | 17 specified plus `RecordNotFound`, `ResetDemoDataDialog`, `ScreenPlaceholder` |

`ScreenPlaceholder` is a temporary placeholder used by route files until feature screens land. It
must be removed when the last route gets its real screen.

### Verification before migration (commit `5f12f53`)

| Command | Exit code | Result |
| --- | --- | --- |
| `pnpm exec tsc -b --noEmit` | 0 | no errors |
| `pnpm lint` | 0 | 0 errors, 6 `only-export-components` warnings in shadcn primitives |
| `pnpm exec vitest run` | 0 | 44 files, 383 tests passed |
| `pnpm build` | 0 | built |

### Git and backup

- `main` had no commits. A full archive was created before any move at
  `../LeaseGuard-backups/LeaseGuard-20261107-pre-monorepo.tar.gz`
  (SHA-256 `9d5f2a98…3d22`). It was extracted to a temporary folder and all 324 files matched the
  source tree by SHA-256.
- Baseline commit `5f12f53` holds 301 files after reviewing the staged list for secrets and build
  output. `CLAUDE.md` and `.agents/` stay untracked because `.gitignore` excludes them.
- Migration commits are on `migration/monorepo`, one per stage, using `git mv` so history follows files.

### Docker

- Colima runs Docker Server 29.5.2. A throwaway Redis 7.4 container started, answered `PONG` and was
  removed, so plain `docker run` works.
- **The Docker Compose plugin is not installed.** `docker compose` and `docker-compose` are both
  missing. Compose files are validated with the `docker:29-cli` image, which bundles Compose.
- Supabase CLI 3.0.0 runs through `npx`. Its local stack provides the only Postgres instance;
  `docker-compose.yml` does not add another.

## Decisions

1. **`packages/domain` (`@leaseguard/domain`).** Domain types and pure rules shared by the backend
   and the frontend demo. No framework imports, no I/O, no clock reads. The backend executes the
   rules authoritatively; the frontend demo reuses them. Neither imports the other's internals.
   The package publishes TypeScript source under the `@leaseguard/source` export condition for
   Vite and tests, and compiled ESM for Node.
2. **Backend owns authoritative behaviour.** Financial calculations, monitoring, eligibility and
   approvals run in the NestJS backend using `@leaseguard/domain`. Python only extracts and validates.
3. **Generated API client.** `packages/api-client` is generated from the backend OpenAPI document.
   No hand-written duplicate contracts.
4. **Simulated frontend layer retained** under `frontend/src/services` until each backend module
   has real endpoints. Demo-only functions such as simulated extraction and delivery never become
   backend endpoints.
5. **One environment file.** `.env.example` at the root; every app reads the root `.env`.
6. **Database access through RLS.** API requests use a Supabase client carrying the caller's JWT.
   The service-role client is for workers only, with explicit `company_id` filters.

## File mapping (executed in commit `10e73b5`)

| From | To | Action |
| --- | --- | --- |
| `index.html`, `vite.config.ts`, `tsconfig*.json`, `components.json`, `.oxlintrc.json`, `public/favicon.svg` | `frontend/` | Moved |
| `package.json` | `frontend/package.json`, new root `package.json` | Split |
| `src/routes/**` | `frontend/src/app/router/routes/**` | Moved |
| router creation in `main.tsx` | `frontend/src/app/router/router.ts` | Extracted |
| providers inside `AppLayout` | `frontend/src/app/providers/AppProviders.tsx` | Consolidated |
| root route components | `frontend/src/app/layouts/RootLayout.tsx` | Extracted |
| `src/index.css` | `frontend/src/styles/globals.css` | Moved |
| `src/components`, `lib`, `store`, `services`, `test`, `main.tsx` | `frontend/src/…` | Moved |
| `src/data/**` | `frontend/src/services/demo/seed/**` | Moved |
| `src/domain/seedConsistency.test.ts` | `frontend/src/services/demo/seed/` | Moved; it tests demo data |
| `src/domain/**` | `packages/domain/src/rules/**` | Moved |
| `src/types/**` | `packages/domain/src/types/**` | Moved |
| `docs/architecture.md` | `docs/architecture/frontend-data-layer.md` | Moved |
| `docs/components.md` | `docs/development/frontend-components.md` | Moved |
| `public/icons.svg` | — | Removed: Vite template asset, unreferenced |
| `next-themes`, `@hookform/resolvers`, `@tanstack/router-devtools` | — | Removed: no imports |
| `dist/`, `.tanstack/` | — | Removed: build output and cache |

## Sequence and status

| Stage | Status | Evidence |
| --- | --- | --- |
| 1. Audit, backup, Git baseline | Done | Archive verified; commit `5f12f53` |
| 2. Frontend into `frontend/`, domain package | Done | Commit `10e73b5`; 383 tests, typecheck, lint, builds, dev server |
| 3. pnpm workspace and root scripts | Partly done | Workspace and base scripts in place; process scripts come with stage 4–8 |
| 4. Backend foundation and workers | In progress | |
| 5. Supabase schema, RLS, storage, seed | In progress | |
| 6. Python document-processing service | In progress | |
| 7. Service-contract fixes and reconciliation | In progress | 19 review findings being re-applied at new paths |
| 8. Docker Compose, API client, start checks | Pending | |
| 9. Documentation | Pending | |
| 10. Full verification and review | Pending | |
