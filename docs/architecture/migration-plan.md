# Repository migration plan

Stage 1 audit of the LeaseGuard repository, 7 November 2026. Target: the approved monorepo
architecture (frontend, backend, python-services, packages/api-client, supabase, infrastructure).

## Audit findings

- **Git.** `main` has no commits. Every file is untracked, so git cannot recover a bad move.
  A full archive is taken before any file moves, and moves are done with plain `mv` so content
  is never regenerated.
- **Ownership.** All source files were produced in this project's earlier stages. There is no
  third-party or hand-written user code at risk. `CLAUDE.md` and `.agents/` are listed in
  `.gitignore` by the user's choice and are left in place.
- **Frontend.** React 19, Vite 8, TanStack Router (file-based, 34 route files), Tailwind v4,
  35 shadcn/ui primitives, 31 shared, 15 form and 17 layout components, Zustand persisted store,
  demo seed for two companies, 38 test files. Typecheck, lint, tests and build pass.
- **Business rules.** Pure TypeScript in `src/domain`: money, SA dates, escalation, lease expiry,
  renewal deadlines, guarantee and deposit coverage, arrears ageing, arrangement schedules and
  suppression, duplicate statements, communication eligibility and message-content checks.
- **Simulated services.** `src/services` implements every service against the local store,
  including simulated WhatsApp, extraction and reports. It is working demo functionality.
- **Unused dependencies.** `next-themes` (Sonner now reads the app's own theme) and
  `@tanstack/router-devtools` (never imported).
- **Tooling on this machine.** Node 26, pnpm 12, Python 3.14, Docker via Colima. No Supabase CLI,
  Redis, Tesseract or Postgres client installed globally.

## Key decisions

1. **Business rules move to the backend and become authoritative there.** The frontend demo mode
   still needs them, and the brief forbids duplicates and generic shared packages. The backend
   package exposes one narrow subpath, `@leaseguard/backend/domain`, containing only pure rule
   functions and entity types. It has no NestJS imports, enforced by a test. The frontend demo
   imports from that subpath, so each rule exists once.
   Alternative needing approval: a dedicated `packages/domain` workspace package.
2. **Domain entity types move to the backend** next to the module that owns them. The backend
   DTOs implement them, the OpenAPI spec is generated from the DTOs, and `packages/api-client`
   is generated from the spec. The frontend uses the generated client for HTTP calls.
3. **The simulated service layer is kept** as the frontend's demo data source, because no backend
   endpoint has data yet without a running Supabase project. A `services/api/` adapter wraps the
   generated client so screens can switch to the real API per module later.
4. **Database access uses `@supabase/supabase-js` with the caller's JWT**, so Postgres Row Level
   Security applies to every API request. The service-role client is used only by workers and
   always filters by `company_id` explicitly.
5. **Workers live in `backend/src/workers`** and start from `backend/src/worker.ts`, sharing modules
   with the API process.

## File mapping

| Existing location | Destination | Action | Reason |
| --- | --- | --- | --- |
| `index.html`, `public/`, `vite.config.ts`, `tsconfig*.json`, `components.json`, `.oxlintrc.json` | `frontend/` | Migrate | Frontend app moves into its workspace package |
| `package.json` | `frontend/package.json` + new root `package.json` | Split | Root becomes the pnpm workspace with orchestration scripts only |
| `pnpm-lock.yaml` | root | Retain | One lockfile for the workspace |
| `src/main.tsx` | `frontend/src/main.tsx` | Migrate | Entry point |
| `src/index.css` | `frontend/src/styles/globals.css` | Migrate | Approved `styles/` directory |
| `src/routes/**` | `frontend/src/app/router/routes/**` | Migrate | Router plugin reads `routesDirectory` from config; route tree regenerated there |
| `src/routeTree.gen.ts` | `frontend/src/app/router/routeTree.gen.ts` | Regenerate | Generated file, not committed |
| router creation in `main.tsx` | `frontend/src/app/router/router.ts` | Consolidate | Router config in one place |
| theme init, tooltip provider, toaster | `frontend/src/app/providers/AppProviders.tsx` | Consolidate | One provider tree |
| root route layout composition | `frontend/src/app/layouts/RootLayout.tsx` | Consolidate | Route-level layout separate from shell components |
| `src/components/{ui,shared,layout,forms}` | `frontend/src/components/…` | Migrate | Already match the approved split |
| `src/lib/*` | `frontend/src/lib/*` | Migrate | Labels, navigation, theme, `cn` |
| `src/store/*` | `frontend/src/store/*` | Migrate | Demo state, workspace switching, persistence |
| `src/services/*` | `frontend/src/services/*` | Migrate | Simulated service layer kept as demo source |
| `src/data/*` | `frontend/src/services/demo/seed/*` | Migrate | Demo seed belongs to the simulated layer only |
| `src/test/setup.ts` | `frontend/src/test/setup.ts` | Migrate | Vitest setup |
| `src/domain/money.ts`, `dates.ts` | `backend/src/common/domain/` | Migrate | Shared rule primitives used by several modules |
| `src/domain/escalation.ts`, `leaseExpiry.ts`, `renewalNotice.ts`, `guarantee.ts`, `arrears.ts` | `backend/src/modules/monitoring/rules/` | Migrate | Monitoring engine owns these rules |
| `src/domain/arrangements.ts` | `backend/src/modules/arrangements/rules/` | Migrate | Arrangement schedules and suppression |
| `src/domain/statementDuplicates.ts` | `backend/src/modules/statements/rules/` | Migrate | Statement workflow |
| `src/domain/communicationEligibility.ts`, `messageContent.ts` | `backend/src/modules/communications/rules/` | Migrate | Messaging restrictions |
| `src/domain/seedConsistency.test.ts` | `frontend/src/services/demo/seed/` | Migrate | Tests demo data, not rules |
| `src/types/*.ts` | `backend/src/modules/<owner>/<owner>.types.ts`, shared primitives in `backend/src/common/domain/` | Migrate | Backend owns the model |
| `docs/architecture.md` | `docs/architecture/frontend-data-layer.md` | Migrate | Approved docs layout |
| `docs/components.md` | `docs/development/frontend-components.md` | Migrate | Approved docs layout |
| `docs/COMPONENT_IMPLEMENTATION_PROGRESS.md` | same | Retain and update | Required by brief |
| `README.md` (Vite template text) | root `README.md` | Rewrite | Describe the real monorepo |
| `dist/`, `.tanstack/` | — | Remove | Build output and cache |
| `next-themes`, `@tanstack/router-devtools` | — | Remove | Unused |

## Sequence

1. Archive, then move the frontend and restore a green build.
2. Root pnpm workspace and scripts.
3. Backend foundation; move rules and types; rewire frontend imports.
4. Supabase migrations, RLS and seed.
5. Backend modules, then workers.
6. Python document-processing service.
7. Generate OpenAPI and `packages/api-client`.
8. Documentation; full verification and review.
