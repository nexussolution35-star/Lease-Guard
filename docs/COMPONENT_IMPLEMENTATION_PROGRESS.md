# Component implementation progress

Tracks the component boilerplate stage. A group is marked complete only when every listed
component has a real source implementation that typechecks.

Specified: 268 component names across 14 groups. `WhatsAppConnectionStatus` is listed under both
Settings and WhatsApp; it is implemented once in the WhatsApp feature and reused by Settings,
so there are 267 unique components.

| Group | Directory | Specified | Status |
| --- | --- | --- | --- |
| A. Application shell | `src/components/layout` | 17 | Complete |
| B. Shared UI | `src/components/shared` | 33 | Complete |
| C. Forms | `src/components/forms` | 15 | Complete |
| Properties | `src/features/properties/components` | 12 | Not started |
| Units | `src/features/units/components` | 10 | Not started |
| Tenants | `src/features/tenants/components` | 15 | Not started |
| Leases | `src/features/leases/components` | 19 | Not started |
| Statements | `src/features/statements/components` | 21 | Not started |
| Monitoring | `src/features/monitoring/components` | 23 | Not started |
| Arrangements | `src/features/arrangements/components` | 14 | Not started |
| Communications | `src/features/communications/components` | 24 | Not started |
| Reports | `src/features/reports/components` | 11 | Not started |
| Settings | `src/features/settings/components` | 16 | Not started |
| WhatsApp Business | `src/features/whatsapp/components` | 38 | Not started |
| Service contracts | `src/services/contracts.ts` + new services | 14 | Not started |

## Foundations already in place

- shadcn/ui primitives (35) in `src/components/ui`, fetched from the official registry.
- Enum labels and status tones in `src/lib/labels.ts`.
- Conventions in `docs/components.md`.
- Application routes for every PRD screen in `src/routes`, rendering inside `AppLayout`.
  Detail routes look records up through services and show "not found in this workspace" for other companies.
