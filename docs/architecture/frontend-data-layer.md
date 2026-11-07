# Frontend data layer

How the frontend demo mode stores and serves data. Paths are relative to `frontend/` unless they
start with `packages/`.

Layers, bottom to top. Each layer may import only from the layers below it.

1. `packages/domain/src/types` — domain models and enums, imported as `@leaseguard/domain`.
2. `src/services/demo/seed` — immutable demo seed. Public API (`@/services/demo/seed`):
   - `DEMO_REFERENCE_DATE: ISODate` — the "today" the demo is authored against: `2026-11-06`.
   - `DEMO_COMPANY_IDS = { nexus: 'cmp_nexus', second: 'cmp_<slug>' }`.
   - `DEMO_DEFAULT_USER_ID` — the Nexus property manager that is "logged in" initially.
   - `createDemoSeed(): Collections` — returns a FRESH deep copy every call (never shared refs).
   - All records satisfy the invariants in `src/services/demo/seed/seed.test.ts`.
3. `packages/domain/src/rules` — pure functions, no framework imports, imported as `@leaseguard/domain`. Every date-sensitive function takes
   `today: ISODate` explicitly (no `new Date()` inside domain code).
4. `src/store` — Zustand store (`useAppStore`) persisted to localStorage key `leaseguard.state`.
   - `src/store/collections.ts` (done): `Collections`, `RecordMap`, `toRecordMap`, `emptyCollections`.
   - State: `{ schemaVersion, workspace: { activeCompanyId, currentUserId }, collections, seededAt }`.
   - Persistence: `persist` middleware, `version` = `SCHEMA_VERSION`; on version mismatch or when
     `validatePersistedState()` fails, discard and reseed from `createDemoSeed()`.
   - Actions: `switchWorkspace(companyId)`, `setCurrentUser(userId)`, `resetDemoData()`,
     generic `upsert(collection, record)`, `remove(collection, id)`, `patch(collection, id, partial)`.
5. `src/services` — typed service modules; the ONLY way UI reads/writes records.
   - `repository.ts`: `createRepository<K extends CollectionKey>(key)` with company-scoped
     `list(query)`, `getById`, `create`, `update`, `archive`/`remove`, plus `ListQuery`
     (`search`, `filters`, `sort`, `page`, `pageSize`) and `PagedResult<T>`.
   - One module per aggregate (companies, users, properties, units, tenants, leases, statements,
     monitoring, arrangements, communications, notifications, audit). Each exposes plain functions
     AND React hooks (`useProperties(query)`, `useProperty(id)`, …) built on `useAppStore` selectors.
   - Every mutating service call writes an `AuditLog` with `actorUserId = workspace.currentUserId`.
   - Services always scope by `workspace.activeCompanyId` unless a function is explicitly global
     (companies list, current user's memberships).
6. `src/app/router/routes` — TanStack file-based routes. Generation options live in `tsr.config.json`.

Conventions: ids are `prefix_slug` (`prop_mall_of_soweto`) or `generateId('lease')` for new rows;
timestamps are ISO 8601 with `+02:00`; money is rands as a JS number rounded to 2dp.
