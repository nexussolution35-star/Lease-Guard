# LeaseGuard component conventions

These rules apply to every component in the repository. Read `CLAUDE.md` and
`docs/architecture/frontend-data-layer.md` first.

## Directory layout (single component architecture)

| Directory | Contents |
| --- | --- |
| `src/components/ui/` | shadcn/ui primitives (new-york style, Radix). Generated; edit only to fix bugs. Kebab-case file names. |
| `src/components/shared/` | App-wide building blocks: data table, badges, displays, states, dialogs, timelines, information grids. |
| `src/components/forms/` | Form field components built on react-hook-form + Zod + shadcn `form.tsx`. |
| `src/components/layout/` | Application shell: layout, sidebar, topbar, workspace switcher, search, notifications. |
| `src/features/<feature>/components/` | Feature components (properties, units, tenants, leases, statements, monitoring, arrangements, communications, whatsapp, reports, settings). |
| `src/features/<feature>/index.ts` | Barrel re-exporting the feature's public components. |

One component per file. File name equals the component name in PascalCase, e.g.
`src/features/leases/components/LeaseVerificationPanel.tsx`.

## Component contract

```tsx
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
- Accept `className?: string` on any component that renders a root element, and merge with `cn()`.
- Types come from `@/types`. Never redeclare a domain model or enum in a component.
- Data comes from typed props or from `@/services` hooks. Never import `@/data` or `@/store` raw
  collections in components. `@/store` selectors for workspace/user are allowed only through services.
- Business rules (money maths, escalation, expiry, renewal deadlines, guarantee coverage, arrears
  ageing, reminder suppression, duplicate detection, communication eligibility, status transitions)
  live in `@/domain` or `@/services`. Components call them and render the result.
- Formatting goes through `CurrencyDisplay` / `DateDisplay` (or `formatZAR` / `formatSADate` from
  `@/domain` when a string is required). Never call `toLocaleString` for money or dates directly.
- Labels and enum display names come from `src/lib/labels.ts`. Add new labels there, not inline.

## States

Components that load or list data support:

- `isLoading?: boolean` → render `LoadingState` / `DataTableLoading` skeletons.
- `error?: Error | string | null` with optional `onRetry` → render `ErrorState`.
- Empty collections → render `EmptyState` (or `DataTableEmptyState`) with a helpful action.

## Styling and accessibility

- Tailwind with semantic tokens only (`bg-card`, `text-muted-foreground`, `border-border`,
  `text-destructive`, `bg-success/10`, `text-warning`…). No raw palette colours like `bg-blue-500`.
- Mobile-first responsive layouts. Tables collapse with horizontal scroll inside their card, never the page.
- Semantic HTML (`section`, `header`, `nav`, `dl`, `table`, `time`). Every input has a label.
  Icon-only buttons have `aria-label`. Status conveyed by colour also has text.
- Lucide icons via `lucide-react`, imported individually, `aria-hidden` when decorative.

## Product rules reflected in UI

- No payment processing UI anywhere. Arrangements and balances are monitoring records.
- Tenant messages are only the five tenant message types. Composer UIs must not offer others for tenants.
- Tenant messages require approval before simulated sending. Bank details never appear in message text.
- Unverified leases are shown with a clear "unverified" state and are not used as financial evidence.
- WhatsApp operations are simulated. No external API calls.

## Tests

Co-locate `*.test.tsx` next to the component. Use Testing Library and query by role/label.
