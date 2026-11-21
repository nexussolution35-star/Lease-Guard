# Frontend data layer

How the web app (`frontend/`) gets its data. Paths are relative to `frontend/src` unless they start
with `packages/`. The only path alias is `@/*` → `frontend/src/*`; domain types and rules come from
`@leaseguard/domain`, the typed API client from `@leaseguard/api-client`.

## One data source

The database is the only source of truth. The web app signs in with Supabase Auth (email/password) and
reads every record from the LeaseGuard API through `@leaseguard/api-client`. There is no demo or offline
mode, no seed and no business data in the frontend; the browser keeps only the TanStack Query cache in
memory and, per user, the last workspace opened (`localStorage`, a convenience only). Settings →
Preferences keeps four more viewer conveniences in this browser only, never business data: the theme
(`leaseguard.theme`, `lib/theme.ts`, shared with the account menu), whether the sidebar starts retracted
(`leaseguard.sidebarCollapsed`, `components/layout/useSidebarCollapsed.ts`, shared with the sidebar's own
toggle), the date display format (`leaseguard.dateFormat`, `lib/dateFormat.ts`: six formats, default
`21 Nov 2026`) and motion (`leaseguard.motion`, `lib/motion.ts`: system, reduce or full, written to
`<html data-motion>`). All are small external stores read through `lib/browserStorage.ts`, which never throws:
with storage blocked the choice still applies for the session and the page says it is not being saved. The
date format changes display only: stored values and API payloads stay ISO, and tenant messages, audit text and
domain validation messages keep the en-ZA default.

`services/api/config.ts` validates `VITE_API_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (all
required) once at startup. `VITE_API_URL` is the gateway origin (ADR 0003), the one base URL for every service: in
development the Vite dev server itself, which proxies `/api/v1/reports` to the reports service and every other `/api`
and `/health` path to the core (`services/api/devGateway.ts`, from `infrastructure/gateway/routes.json`). Unit tests use fixed, unreachable values (`test.env` in
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
| properties | `usePropertyList`, `usePropertyQuery`, `useCreateProperty`, `useUpdateProperty`, `useArchiveProperty`, `useRestoreProperty` |
| portfolio-imports | `usePortfolioImportQuery`, `useUploadPortfolioFile` (signed upload to storage, then `createPortfolioImport`), `useSelectPortfolioImportSheet`, `useImportGoogleSheet` (`createPortfolioImportFromGoogleSheet`: the API reads the linked sheet); `usePortfolioImportMappingQuery`, `useSavePortfolioImportMapping`, `usePortfolioImportPreviewQuery` (ticket I-02, keyed by the batch's `updatedAt` so another sheet never shows the previous sheet's mapping or rows); `useChangePortfolioImportRow` (ticket I-03: correct, skip or link a row; invalidates the batch, its mapping and preview, and the history) and `usePortfolioImportList` (the import history); `usePortfolioImportSummaryQuery` and `useApprovePortfolioImport` (ticket I-04: `getPortfolioImportSummary` / `approvePortfolioImport`; the summary sits under the batch's preview key so a row fix reads it again, and approving invalidates the batch, the history and the property, unit and tenant lists); ticket I-05: `useChangePortfolioImportRow` also confirms or rejects a row's suggested tenants (`tenantMatch`) |
| units | `useUnitList` (items are `UnitListItem`: property, current tenant and lease embedded), `useUnitQuery`, `useCreateUnit`, `useUpdateUnit` |
| tenants | `useTenantList` (items are `TenantListItem`: current lease with unit and property, lease count), `useTenantQuery`, `useCreateTenant`, `useUpdateTenant`, `useValidateTenantWhatsApp` (`POST /tenants/{id}/whatsapp-validation`; 409 when the number changed meanwhile) |
| leases | `useLeaseList` (items are `LeaseListItem`: tenant, property and unit names; `expiresWithinDays` filter), `useLeaseQuery`, `useLeaseDocuments`, `useUploadLeaseDocument` (signed upload, the PDF straight to storage, then
`registerLeaseDocument`; `LeaseDocumentUploadError` when storage refuses the file), `useLeaseDocumentLink` (five-minute
download link), `useVerifyLease`, `useCreateLease`, `useUpdateLease` |
| statements | `useStatementList` (items are `StatementListItem`: property, tenant and unit names; `uploadBatchId` follows one upload batch), `useStatementQuery`, `useStatementUploader` (S-03: `upload` signs, sends the PDF straight to storage and registers it, an identical file on record coming back as an `identical` outcome rather than an error; `refresh` after a batch; the batch itself is run by `features/statements/upload/runUploadBatch`), `useRetryStatementProcessing` (`POST /statements/{id}/process`: queues processing again, also after a failure), `useStatementArrears` (`GET /statements/arrears`: the arrears figures the API calculated from verified statements; keyed under the statements prefix, so anything that refreshes statements refreshes them); review (S-04): `useStatementExtraction` (`GET /statements/{id}/extraction`, null before extraction; keyed under the statement's detail key), `useStatementFileLink` (five-minute link to the original file, for opening it in a new tab), `useStatementFileUrl` (S-06: the same link as a query for the PDF embedded on the review screen, kept four minutes and never refetched on focus, under its own key so refreshing the statement does not reload the document), `useCorrectStatementField` / `useConfirmStatementField` (store the returned extraction), `useSetStatementMatch` (tenant, unit and lease together; stores the statement and refreshes the lists); outcome (S-05): `useVerifyStatement` (`POST /statements/{id}/verify`; resolves to `{ statement, monitoringQueued }`, a refusal is an `ApiError` 422 with every reason in `messages`), `useRejectStatement` (the reason), `useMarkStatementDuplicate` (the other statement's id); together (S-07): `useVerifyStatements` (`POST /statements/verify` with the ids of list rows whose `readyToVerify` is true; resolves to `{ verified, notVerified }`, each refused statement with every reason; the request fails only as a whole, e.g. offline); each refreshes every statement record, the arrears figures included |
| monitoring | `useMonitoringEventList` (items are `MonitoringEventListItem`: property, unit, tenant and assignee names; filters `status` or `open`, `priority`, `type`, `propertyId`, `unitId`, `tenantId`, `leaseId`, `assignee` (a user id or `unassigned`) and `due` (a `MONITORING_DUE_WINDOWS` value, applied by the API on the South African date)), `useMonitoringEventQuery` (the same `MonitoringEventListItem`, names included), `useUpdateMonitoringEventStatus` (M7-02: `PATCH /monitoring/events/{id}/status` with `{ status, note? }`; stores the returned event and refreshes every monitoring record and the audit log, which holds the event's history). `/monitoring` keeps its list state in the URL (`features/monitoring/listSearch.ts`; `status=open` or `closed` becomes the API's `open` flag) |
| arrangements | `useArrangementList`, `useArrangementQuery`, `useCreateArrangement`, `useUpdateArrangement`, `useCloseArrangement`, `useCancelArrangement`, `useRecordInstallmentOutcome` (each write caches the returned arrangement and refreshes the arrangement lists and the statements arrears summary; every arrangement carries its tenant, property, unit and lease names, `PaymentArrangementListItem`) |
| communications | `useCommunicationList`, `useCommunicationQuery` |
| reports | `useReportCatalogue` (`GET /api/v1/reports`, key `['reports', companyId, 'catalogue']`) and `useReport(id, filters)` (`GET /api/v1/reports/{reportId}` for the ids in `AVAILABLE_REPORT_IDS`, `features/reports/api/source.ts`; key `['reports', companyId, 'report', id, filters]`; the previous figures stay on screen while new filters load, never another company's). Both reach the reports service through the gateway (ADR 0003). `/reports/$reportId` keeps the report frame's filters in the URL (`features/reports/reportSearch.ts`: `propertyId` and `status` lists, `from`, `to`; invalid values fall back to no filter, and only the filters the report offers apply, `REPORT_FILTER_SUPPORT`). The frame (`features/reports/components/ReportFrame.tsx`) exports exactly the rows shown as CSV (`features/reports/csv.ts`: RFC 4180, amounts as plain rand with two decimals, ISO dates, formula-like text kept as text, UTF-8 with a byte order mark) and prints the work area only (the app chrome is `print:hidden`, print rules in `styles/globals.css`). The weekly owner summary (`OwnerWeeklySummaryReportView`, R-07) is listed and served for company admins only (`reportCatalogueFor`); it shows each owner's summary, the WhatsApp text and this week's send, and says why nothing is sent when no approved template or no connected number exists |
| dashboard | `useDashboardSummary` (`GET /dashboard/summary`: every PRD §7.1 figure in one request, the balances from one database query, key `['dashboard', companyId, 'summary']`; not invalidated by other writes, it is read afresh once stale, after 30 s) |
| message-templates | `useMessageTemplateSettings` (`GET /message-templates`; `polling` reads it again every 3 s after a sync), `useChooseMessageTemplate` (`PUT /message-templates/{messageType}`; a refusal is an `ApiError` 422 with every reason), `useSyncMessageTemplates` (`POST /message-templates/sync`; refreshes the settings and the synced WhatsApp templates) |
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
- Dates are ISO strings; display them with the `DateDisplay` component or `useDateFormatter()`
  (`lib/dateFormat.ts`, the one formatter, in the Preferences format); money with `formatZAR` or
  `CurrencyDisplay`.
