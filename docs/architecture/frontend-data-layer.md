# Frontend data layer

How the web app (`frontend/`) gets its data. Paths are relative to `frontend/src` unless they start
with `packages/`. The only path alias is `@/*` → `frontend/src/*`; domain types and rules come from
`@leaseguard/domain`, the typed API client from `@leaseguard/api-client`.

## One data source

The database is the only source of truth. The web app signs in with Supabase Auth (email/password) and
reads every record from the LeaseGuard API through `@leaseguard/api-client`. There is no demo or offline
mode, no seed and no business data in the frontend; the browser keeps only the TanStack Query cache in
memory and, per user, the last workspace opened (`localStorage`, a convenience only).

`services/api/config.ts` validates `VITE_API_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (all
required) once at startup. Unit tests use fixed, unreachable values (`test.env` in
`frontend/vite.config.ts`) and fake the API client or the source under test.

## Layers

Each layer imports only from the layers above it in this table.

| Layer | Path | Role |
| --- | --- | --- |
| Domain | `packages/domain` (`@leaseguard/domain`) | Types, enums and pure business rules |
| API services | `services/api/` | Configuration, Supabase auth client, the API client, the query client |
| Store | `store/` | Zustand store: the active workspace only |
| Data helpers | `lib/data/` | List params, query keys, lazy sources, company-scoped queries |
| Feature sources | `features/<feature>/api/` | One source interface per feature with its API implementation, plus TanStack Query hooks |
| Screens | `features/<feature>/components/`, `app/router/routes/` | Read data only through feature hooks |

### `services/api/`

| File | Purpose |
| --- | --- |
| `config.ts` | Validates the `VITE_*` variables with zod; `getAppConfig()` throws a `ConfigError` for an invalid configuration (main.tsx shows the error screen instead of the app). Unknown `VITE_*` variables are ignored |
| `exposedSecrets.ts` | Refuses Supabase secret or service-role keys in any `VITE_*` variable (also used by `vite.config.ts`) |
| `supabase.ts` | Lazy browser Supabase client, used for authentication only; `getAccessToken()` |
| `client.ts` | `getApiClient()`: the single `@leaseguard/api-client` instance. Sends the access token and the active company as `X-Company-Id`; a 401 signs out locally |
| `queryClient.ts` | TanStack Query client: 30 s stale time; retries only retryable `ApiError`s (network, 429, 5xx), at most 2 |

`services/query.ts` holds the list-query state types used by the shared table components.

### `store/`

`store/appStore.ts` exports `useAppStore` with `{ activeCompanyId, setActiveCompany }`, in memory only.
The workspace gate sets the active company; `selectActiveCompanyIdOrNull` / `getActiveCompanyIdOrNull`
return `null` until one is selected.

### `lib/data/`

| File | Exports |
| --- | --- |
| `dataSource.ts` | `lazySource(create)`: creates a feature source on first use and caches it, so the API and Supabase clients are never constructed at import time |
| `listParams.ts` | `ListParams` (`page`, `pageSize`, `search`, `sort`, `direction`), `Page`, `DEFAULT_LIST_PAGE_SIZE` (25), `MAX_LIST_PAGE_SIZE` (100), `pageCountOf` |
| `queryKeys.ts` | `createEntityKeys(entity)`: every key starts with `[entity, companyId]` |
| `queries.ts` | `useCompanyQuery(key, fetcher, options)`: a query scoped to the active company, disabled while none is selected; `isAwaitingWorkspace` |
| `useActiveCompanyId.ts` | The active company id or `null` |
| `ids.ts` | `isUuid` |

Because every key carries the company id, switching workspace never serves another company's cache,
and screens refetch for the new company.

## Feature sources

Each feature has the same files under `features/<feature>/api/`:

| File | Contents |
| --- | --- |
| `source.ts` | The source interface (for example `PropertySource` with `list(companyId, params)` and `get(companyId, id)`), the feature's list params, and allowed sort fields typed against the generated `*SortField` |
| `apiSource.ts` | The implementation over the generated client |
| `selectSource.ts` | `get<Feature>Source = lazySource(() => createApi<Feature>Source(getApiClient()))` |
| `queries.ts` | Query keys and hooks, for example `usePropertyList(params)` and `usePropertyQuery(id)` |
| `index.ts` | Public exports |

| Feature | Hooks |
| --- | --- |
| properties | `usePropertyList`, `usePropertyQuery` |
| units | `useUnitList`, `useUnitQuery` |
| tenants | `useTenantList`, `useTenantQuery` |
| leases | `useLeaseList`, `useLeaseQuery` |
| statements | `useStatementList`, `useStatementQuery` |
| monitoring | `useMonitoringEventList`, `useMonitoringEventQuery` |
| arrangements | `useArrangementList`, `useArrangementQuery` |
| communications | `useCommunicationList`, `useCommunicationQuery` |
| notifications | `useNotificationList`, `useUnreadNotificationCount`, `useMarkNotificationRead`, `useMarkAllNotificationsRead` |
| account | `useCurrentUserProfile` (`GET /me`), `useUpdateProfile` (`PATCH /me`) |
| company | `useCompanyProfile`, `useUpdateCompany` (`PATCH /companies/{id}`: profile and monitoring settings), `useOnboardingChecklist` |
| audit | `useAuditLogList` (`GET /audit-logs`, newest first; audit readers only) |

API sources follow the same rules:

- Map list params to the endpoint's real query parameters only, with `compactQuery`.
- Send the company from the query key as `X-Company-Id` explicitly.
- `get` returns `null` for a 404, and for a non-UUID id without making a request.
- Rethrow every other `ApiError`.
- Generated DTOs are assignable to the `@leaseguard/domain` types without casts.

## Signed-in user and workspace

`app/router/routes/__root.tsx` redirects every route except `/login` to `/login` without a session
(`features/auth/guard.ts`). After sign-in, `WorkspaceGate` (`features/account/components/`) wraps the
shell in `RootLayout` and loads `GET /api/v1/me` (query key `['me', userId]`) before any company data is
requested:

1. `resolveWorkspace` (`features/account/workspace.ts`) picks the company already selected in this
   tab, else the one remembered in `localStorage` under `leaseguard.api.workspace.<userId>` (a
   convenience only), as long as the user is still a member; otherwise the default membership or the
   first one. The gate calls `setActiveCompany` and remembers the choice.
2. No memberships, or no LeaseGuard profile (`/me` answers 404): `NoWorkspaceAccess` with sign-out.
3. Other failures: an error state with "Try again". A 401 signs the user out.

Signing out clears the query cache and the active company.

The account menu (`components/layout/AccountMenu.tsx`) edits the user's own profile with
`useUpdateProfile` (`features/account/components/EditProfileDialog.tsx`; an emptied optional field is
sent as `null`). Changing the password is by email link: `useAuth().sendPasswordChangeLink()`
(`features/auth/SupabaseAuthProvider.tsx`) calls `resetPasswordForEmail` for the signed-in email with
`redirectTo` `/auth/reset-password`, and that page sets the new password with `updateUser({ password })`
from the session the link created. With Supabase's secure password change enabled, a session older than Supabase's
reauthentication window cannot set a password without an emailed link, and the app never offers an
in-place change. Links expire after 3 minutes (`EMAIL_LINK_LIFETIME`, matching `otp_expiry`). Rate limits (`429`, "after N seconds") are shown with a matching resend cooldown.

## Rules for screens and components

- Read records only through `features/<feature>/api` hooks; never hardcode business records.
- The shell offers no global search or navigation badge counts until the API has endpoints for them.
- Detail screens wrap a detail query in `RecordQueryView` (`components/shared`), which renders the
  loading, error, no-workspace and not-found states.
- Business rules come from `@leaseguard/domain`, never from components.

## Adding a feature

1. Define the source interface and list params in `features/<feature>/api/source.ts`, using the
   generated `*SortField` type for sorting.
2. Implement `apiSource.ts` with `getApiClient()`'s client following the rules above. If the endpoint
   changed, run `pnpm api:generate` first.
3. Create it lazily in `selectSource.ts`, and add hooks in `queries.ts` with `createEntityKeys` and
   `useCompanyQuery`.
4. Test the API source against a fake client (see existing `apiSource.test.ts` files and
   `test/fakeApi.ts`), and hooks or screens against a mocked `selectSource` (see
   `features/properties/components/PropertyListScreen.test.tsx`).

## Conventions

- Record ids are UUIDs.
- Money is rands as a number rounded to 2 decimals in the domain model; on the extraction wire it is a
  `ZarDecimal` string.
- Dates are ISO strings; format them with `formatSADate` / `formatZAR` or the `DateDisplay` /
  `CurrencyDisplay` components.
