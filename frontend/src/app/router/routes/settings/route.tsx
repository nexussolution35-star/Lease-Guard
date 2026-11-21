import { createFileRoute, Outlet } from '@tanstack/react-router'

import { AppLink } from '@/components/shared'

const SETTINGS_LINKS = [
  { to: '/settings/company', label: 'Company' },
  { to: '/settings/users', label: 'Users' },
  { to: '/settings/roles', label: 'Roles' },
  { to: '/settings/notifications', label: 'Notifications' },
  { to: '/settings/integrations/whatsapp', label: 'Integrations' },
  { to: '/settings/templates', label: 'Templates' },
  { to: '/settings/audit', label: 'Audit log' },
  { to: '/settings/preferences', label: 'Preferences' },
] as const

export const Route = createFileRoute('/settings')({
  component: function SettingsLayout() {
    return (
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
        {/* A hairline under the strip on phones and beside the list from lg: a ruled margin, not a boxed panel. */}
        <nav aria-label="Settings" className="-mx-4 border-b border-border px-4 md:mx-0 md:px-0 lg:w-48 lg:shrink-0 lg:border-r lg:border-b-0 lg:pr-4">
          <ul className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:gap-px lg:overflow-visible lg:pb-0">
            {SETTINGS_LINKS.map((link) => (
              <li key={link.to}>
                <AppLink
                  to={link.to}
                  className="flex h-8 items-center rounded-md px-2 text-sm whitespace-nowrap text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset motion-reduce:transition-none aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground"
                >
                  {link.label}
                </AppLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    )
  },
})
