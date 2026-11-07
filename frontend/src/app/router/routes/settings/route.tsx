import { createFileRoute, Outlet } from '@tanstack/react-router'

import { AppLink } from '@/components/shared'

const SETTINGS_LINKS = [
  { to: '/settings/company', label: 'Company' },
  { to: '/settings/users', label: 'Users' },
  { to: '/settings/roles', label: 'Roles' },
  { to: '/settings/notifications', label: 'Notifications' },
  { to: '/settings/whatsapp', label: 'WhatsApp' },
  { to: '/settings/templates', label: 'Templates' },
  { to: '/settings/audit', label: 'Audit log' },
  { to: '/settings/preferences', label: 'Preferences' },
] as const

export const Route = createFileRoute('/settings')({
  component: function SettingsLayout() {
    return (
      <div className="flex flex-col gap-6 lg:flex-row">
        <nav aria-label="Settings" className="lg:w-48 lg:shrink-0">
          <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {SETTINGS_LINKS.map((link) => (
              <li key={link.to}>
                <AppLink
                  to={link.to}
                  className="block rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-[current=page]:bg-primary/10 aria-[current=page]:font-medium aria-[current=page]:text-primary"
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
