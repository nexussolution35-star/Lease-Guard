# Component implementation progress

Tracks the web app's component and screen work. A group is complete only when every listed component
has a real source implementation that type-checks. Paths are under `frontend/src`.

Specified: 268 component names across 14 groups. `WhatsAppConnectionStatus` is listed under both
Settings and WhatsApp; it is to be implemented once in the WhatsApp feature and reused by Settings,
so there are 267 unique components.

## Status by group

Counts are component files (`.tsx`, excluding tests and test helpers) on disk in this change set.

| Group | Directory | Specified | On disk | Status |
| --- | --- | --- | --- | --- |
| A. Application shell | `components/layout` | 17 | 20 | Complete without global search and navigation badge counts (removed with demo mode; no API endpoints yet). Extras: `RecordNotFound`, `ScreenPlaceholder`, `AccountMenu` (profile management), `NotificationPopover`, `ThemeSubMenu`, `WorkspaceSwitcherTrigger` |
| B. Shared UI | `components/shared` | 33 | 37 | Complete. Extras: `AppLink`, `NoActiveWorkspace`, `RecordQueryView`, `SingleSelectFilter` |
| C. Forms | `components/forms` | 15 | 17 | Complete. Extras: `FieldMessage`, `RequiredIndicator` |
| Properties | `features/properties/components` | 12 | 3 | PRD module 2 complete: `PropertyListScreen` (search, filters, sort, paging, "Add property" for writers), `PropertyFormDialog` (create and edit), `PropertyDetailScreen` (details, counts, units, open monitoring events, archive and restore) |
| Portfolio import | `features/portfolio-imports/components` | — | 1 | Ticket I-01 (upload a portfolio file): `PortfolioImportScreen` (upload step with the CSV template and the columns LeaseGuard reads; the accepted batch with file, format, sheet choice, row count, columns found and who uploaded it). "Import from file" on the Properties screen (properties with units) and in a property's Units section (units of that property), writers only. Ticket I-06: `GoogleSheetLinkForm` in the upload step (paste a Google Sheets link, "Read sheet"; the API keeps a CSV copy as the batch's file), and the batch's details link back to the sheet. Ticket I-02: `ImportMappingPreview` on the accepted batch (column mapping per LeaseGuard field, suggested, reused from the last file with the same headings or applied; "Apply mapping" for writers, read-only otherwise; every row checked against LeaseGuard with a status dot and text per result, the reason or both conflicting values, filters by result and paging). Ticket I-03: a "Fix" action per row for writers opens `RowResolutionDrawer` (correct values, link to an existing property or unit, skip or include again; "Save and check again" shows the row checked again at once), each changed row shows its corrections (file value to new value), link or skip with the sign-off mark (who and when), and `ImportHistory` ("Earlier imports") on the upload step reopens a batch left with rows to fix. Ticket I-04: `ImportApproval` on the batch (import summary as hairline rows: properties and units to create, rows linked, skipped and still blocked with a warning dot; "Tenant messaging stays off" notice; accounting system choice when properties are created; "Approve and import" for writers, the approval's sign-off mark, and "Records created" with a link to each property and unit); the batch header reads "Imported" once records exist. Ticket I-05: the template and "Columns LeaseGuard reads" list the optional tenant columns; the preview has a Tenant column (name and New tenant / Existing tenant / Suggested match) and a "Suggested match" filter; `RowResolutionDrawer` has a Tenant section (result and reasons, missing contact details, the suggested tenants with "This tenant" and "None of these: add a new tenant", the decision's sign-off and "Withdraw"); `ImportApproval` adds tenants to create, rows linked to existing tenants and suggested tenants to confirm (warning dot), a "Missing contact details" list (blocked ones marked), and created tenants linked to their tenant page with their unit; the tenant detail shows the account reference when there is one |
| Units | `features/units/components` | 10 | 3 | PRD module 3 complete: `UnitListScreen` (search, property / unit type / occupancy filters, sort, paging, tenant and lease of occupied units), `UnitDetailScreen` (`/units/$unitId`: property, occupancy, current tenant and lease linked to their screens with the lease term bar and who verified it, lease history newest first, details in the rail; one "Edit" action for writers, read-only while the property is archived), `UnitFormDialog` (create and edit; property fixed once the unit exists; "Add unit" in a property's Units section preselects that property and opens the new unit) |
| Tenants | `features/tenants/components` | 15 | 3 | PRD module 4 complete: `TenantListScreen` (search, status and property filters, sort, paging; contact person, unit and lease reference of the current lease, WhatsApp number validated or not, status as dot and text; "Add tenant" for writers), `TenantDetailScreen` (`/tenants/$tenantId`: WhatsApp number with who validated it as the sign-off mark, why automated reminders are off when they are (`tenantCommunicationBlockers`), the one "Validate number" action for writers; arrears aged from the latest verified statement only (`ageArrears`) and whether an active arrangement pauses reminders; units and leases with term bars and who verified the terms; statement and communication history through their feature hooks; details in the rail; "Edit" for writers), `TenantFormDialog` (create and edit; the WhatsApp number checked with `normalizeWhatsAppNumber` as the API does, and stored in E.164) |
| Leases | `features/leases/components` | 19 | 4 | PRD module 5 in progress: `LeaseListScreen` (search by reference or tenant; status, verification, property and expiring-within filters; sort, paging, all in the URL; tenant, property and unit of each row; verification mark on every row, unverified as the open dashed ring), `LeaseTermBars`, `LeaseDetailScreen` (`/leases/$leaseId`: verification as the sign-off mark with who and when, the one "Verify terms" action for writers and a note that unverified terms are not used for financial monitoring; term bar with the renewal-notice deadline, escalation schedule, deposit and guarantee cover, all from `@leaseguard/domain`; monitoring events of the lease; parties and dates in the rail). `LeaseDocuments` (M5-02, the lease's Documents section: type, uploader and date per document, "Open" through a five-minute link; "Upload document" for writers, a secondary action, opens a dialog for one PDF of at most 20 MB with its document type and title). Create and edit API and data layer done (M5-01: `createLease` / `updateLease`, `useCreateLease` / `useUpdateLease`; a term change unverifies a verified lease, `editRequiresReverification` in `@leaseguard/domain`). `LeaseFormDialog` (M5-05: add from the list ("Add lease" for writers), edit from the lease ("Edit", the primary action once verified); sections for parties, term, rental and escalation, renewal, deposit and guarantee, with the amount fields the escalation type uses; dates as `dd MMM yyyy` with year dropdowns, amounts in rand; a verified lease warns before a term change returns it to pending verification (`editRequiresReverification`); API refusals on the field they name, `leaseFormSchema.ts`) |
| Statements | `features/statements/components` | 21 | 0 | Not started |
| Monitoring | `features/monitoring/components` | 23 | 0 | Not started |
| Arrangements | `features/arrangements/components` | 14 | 0 | Not started |
| Communications | `features/communications/components` | 24 | 0 | Not started |
| Reports | `features/reports/components` | 11 | 0 | Not started |
| Settings | `features/company/components`, `features/users/components`, `features/audit/components` | 16 | 11 | Company, Notifications, Users, Roles and Audit log are real screens (PRD module 1). Templates and Preferences are still placeholders. Settings screens live in the feature that owns their data, not in `features/settings` |
| WhatsApp Business | `features/whatsapp/components` | 38 | 0 | Not started |

Outside the specification: `features/auth/components` (`LoginForm`, `LoginScreen`) and
`features/account/components` (`WorkspaceGate`, `NoWorkspaceAccess`, `EditProfileDialog`,
`ChangePasswordDialog`).

The original "Service contracts" row (14 new service contracts in `services/contracts.ts`) has been
overtaken by the per-feature data sources: screens read data through `features/<feature>/api`. Demo
mode and its in-browser services were removed; the API is the only data source.

## Screens (route files)

`app/router/routes` has 43 route files; 15 of them still render `ScreenPlaceholder`.

| State | Routes |
| --- | --- |
| Real screen | `/login`, `/auth/accept`, `/auth/forgot-password`, `/auth/reset-password`, `/` (dashboard: onboarding and WhatsApp activity), `/properties`, `/properties/$propertyId`, `/properties/import`, `/units`, `/units/$unitId`, `/tenants`, `/tenants/$tenantId`, `/leases`, `/leases/$leaseId`, `/communications/approvals`, `/communications/analytics`, `/settings/company`, `/settings/notifications`, `/settings/users`, `/settings/roles`, `/settings/audit`, `/settings/integrations/whatsapp`, `/settings/integrations/whatsapp/agent` |
| Layout or redirect | `__root` (shell, auth guard, not-found), `/settings` (section navigation), `/settings/` (to `/settings/company`), `/communications` (Messages, Approvals, Analytics navigation), `/settings/integrations/` and `/settings/whatsapp` (to `/settings/integrations/whatsapp`) |
| Record loaded, body is `ScreenPlaceholder` | `/statements/$statementId`, `/monitoring/$eventId`, `/arrangements/$arrangementId` (each loads the record through its feature hook and shows "not found in this workspace" for other companies), `/reports/$reportId` (resolves the report definition) |
| `ScreenPlaceholder` only | `/statements`, `/statements/upload`, `/monitoring`, `/arrangements`, `/communications` (messages), `/whatsapp`, `/reports`, `/settings/templates`, `/settings/preferences` |

`ScreenPlaceholder` is temporary. Remove it when the last route gets its real screen.

## Foundations in place

- shadcn/ui primitives (35) in `components/ui`.
- Data sources and TanStack Query hooks (list and detail) for properties, units, tenants, leases,
  statements, monitoring events, arrangements and communications; notifications and the signed-in
  account (`GET`/`PATCH /me`); create and edit mutations for properties, units and tenants, and tenant WhatsApp
  number validation. See
  [the frontend data layer](architecture/frontend-data-layer.md).
- Enum labels and status tones in `lib/labels.ts`.
- Conventions in [frontend component conventions](development/frontend-components.md).
