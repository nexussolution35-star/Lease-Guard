# LeaseGuard component conventions

These rules apply to every component in the web app. Read `CLAUDE.md` and
[the frontend data layer](../architecture/frontend-data-layer.md) first.

Paths below are under `frontend/src`. The only path alias is `@/*` → `frontend/src/*`. Domain types
and rules come from `@leaseguard/domain`; the API client from `@leaseguard/api-client`.

## Directory layout

| Directory | Contents |
| --- | --- |
| `components/ui/` | shadcn/ui primitives (new-york style, Radix). Generated; edit only to fix bugs. Kebab-case file names. |
| `components/shared/` | App-wide building blocks: data table, badges, displays, states, dialogs, timelines, information grids, `RecordQueryView`. |
| `components/forms/` | Form field components built on react-hook-form + Zod + the shadcn `form.tsx`, and the local `zodResolver`. |
| `components/layout/` | Application shell: layout, sidebar, topbar, workspace switcher, search, notifications, account menus. |
| `features/<feature>/api/` | The feature's data source and TanStack Query hooks (see the data layer). |
| `features/<feature>/components/` | Feature screens and components. |
| `features/<feature>/index.ts` | Barrel re-exporting the feature's public API, where one exists. |

One component per file. The file name equals the component name in PascalCase, for example
`features/properties/components/PropertyListScreen.tsx` (the reference list screen).

## Component contract

```tsx
import type { Lease } from '@leaseguard/domain'

import { cn } from '@/lib/utils'

export interface LeaseVerificationPanelProps {
  lease: Lease
  onVerified?: (lease: Lease) => void
  className?: string
}

export function LeaseVerificationPanel({ lease, onVerified, className }: LeaseVerificationPanelProps) {
  ...
}
```

- Named exports only, no default exports. Export the props interface as `<Name>Props`.
- Accept `className?: string` on any component that renders a root element, and merge with `cn()`
  from `@/lib/utils`.
- Types come from `@leaseguard/domain`, or from `@leaseguard/api-client` for wire-only shapes. Never
  redeclare a domain model or enum in a component.
- Data comes from typed props or from the hooks in `@/features/<feature>/api` (for example
  `usePropertyList`, `usePropertyQuery`). Never hardcode business records in components; the store
  holds only the active workspace.
- Business rules (money maths, escalation, expiry, renewal deadlines, guarantee coverage, arrears
  ageing, reminder suppression, duplicate detection, communication eligibility, status transitions)
  live in `@leaseguard/domain`. Components call them and render the result.
- Format through `CurrencyDisplay` / `DateDisplay`, or `formatZAR` / `formatSADate` from
  `@leaseguard/domain` when a string is required. Never call `toLocaleString` for money or dates
  directly.
- Labels and enum display names come from `@/lib/labels`. Add new labels there, not inline.

## States

Components that load or list data support:

- `isLoading?: boolean` → `LoadingState` / `DataTableLoading` skeletons.
- `error?: Error | string | null` with optional `onRetry` → `ErrorState`.
- Empty collections → `EmptyState` (or `DataTableEmptyState`) with a helpful action.
- No workspace selected yet (before `GET /me` resolves) → `NoActiveWorkspace`.

Detail screens wrap their query in `RecordQueryView`, which renders all of these plus a not-found
element (usually `RecordNotFound` from `components/layout`).

## Forms

Use the field components from `@/components/forms` with react-hook-form. Validate with a Zod schema
through `zodResolver` exported by `@/components/forms` (there is no `@hookform/resolvers`
dependency).

## Styling and accessibility

- Tailwind with semantic tokens only (`bg-card`, `text-muted-foreground`, `border-border`,
  `text-destructive`, `bg-success/10`, `text-warning`…), defined in `styles/globals.css`. No raw
  palette colours such as `bg-blue-500`.
- Mobile-first responsive layouts. Tables scroll horizontally inside their card, never the page.
- Semantic HTML (`section`, `header`, `nav`, `dl`, `table`, `time`). Every input has a label.
  Icon-only buttons have `aria-label`. Status conveyed by colour also has text.
- Lucide icons from `lucide-react`, imported individually, `aria-hidden` when decorative.

## Product rules reflected in UI

- No payment processing UI anywhere. Arrangements and balances are monitoring records.
- Tenants receive only the five tenant message types. Composer UIs must not offer others for tenants.
- Tenant messages require property-manager approval before sending. Any company admin or property
  manager may approve, including the person who requested the approval; read-only users and property
  owners cannot. Bank details never appear in message text.
- Unverified leases are shown with a clear "unverified" state and are not used as financial evidence.
- The web app never calls the WhatsApp API; the worker sends approved messages.

## Tests

Co-locate `*.test.tsx` next to the component. Use Testing Library and query by role and label.
Helpers live in `test/` (`renderApp.tsx`, `appApi.ts` (a fake API for whole-app tests),
`queryClient.tsx`, `fakeApi.ts`, `sampleRecords.ts`, auth and account fixtures),
`components/forms/testHarness.tsx` and `components/layout/testRouter.tsx`. Tests fake the API client
or the feature source; they never reach a real API, Supabase project or `.env`.
