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
| Properties | `features/properties/components` | 12 | 1 | Started: `PropertyListScreen` (search, filters, sort, paging) |
| Units | `features/units/components` | 10 | 0 | Not started |
| Tenants | `features/tenants/components` | 15 | 0 | Not started |
| Leases | `features/leases/components` | 19 | 0 | Not started |
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

`app/router/routes` has 42 route files; 20 of them still render `ScreenPlaceholder`.

| State | Routes |
| --- | --- |
| Real screen | `/login`, `/auth/accept`, `/auth/forgot-password`, `/auth/reset-password`, `/` (dashboard: onboarding and WhatsApp activity), `/properties`, `/communications/approvals`, `/communications/analytics`, `/whatsapp/conversations`, `/settings/company`, `/settings/notifications`, `/settings/users`, `/settings/roles`, `/settings/audit`, `/settings/integrations/whatsapp`, `/settings/integrations/whatsapp/agent` |
| Layout or redirect | `__root` (shell, auth guard, not-found), `/settings` (section navigation), `/settings/` (to `/settings/company`), `/communications` (Messages, Approvals, Analytics navigation), `/settings/integrations/` and `/settings/whatsapp` (to `/settings/integrations/whatsapp`) |
| Record loaded, body is `ScreenPlaceholder` | `/properties/$propertyId`, `/units/$unitId`, `/tenants/$tenantId`, `/leases/$leaseId`, `/statements/$statementId`, `/monitoring/$eventId`, `/arrangements/$arrangementId` (each loads the record through its feature hook and shows "not found in this workspace" for other companies), `/reports/$reportId` (resolves the report definition) |
| `ScreenPlaceholder` only | `/units`, `/tenants`, `/leases`, `/statements`, `/statements/upload`, `/monitoring`, `/arrangements`, `/communications` (messages), `/whatsapp`, `/reports`, `/settings/templates`, `/settings/preferences` |

`ScreenPlaceholder` is temporary. Remove it when the last route gets its real screen.

## Foundations in place

- shadcn/ui primitives (35) in `components/ui`.
- Data sources and TanStack Query hooks (list and detail) for properties, units, tenants, leases,
  statements, monitoring events, arrangements and communications; notifications and the signed-in
  account (`GET`/`PATCH /me`). See
  [the frontend data layer](architecture/frontend-data-layer.md).
- Enum labels and status tones in `lib/labels.ts`.
- Conventions in [frontend component conventions](development/frontend-components.md).
