import { createFileRoute, Link, Outlet } from '@tanstack/react-router'

const COMMUNICATIONS_LINKS = [
  { to: '/communications', label: 'Messages', exact: true },
  { to: '/communications/approvals', label: 'Approvals', exact: false },
  { to: '/communications/analytics', label: 'Analytics', exact: false },
] as const

/** Communications sections: every screen under `/communications` is one click from the others. */
export const Route = createFileRoute('/communications')({
  component: function CommunicationsLayout() {
    return (
      <div className="flex flex-col gap-6">
        <nav aria-label="Communications" className="border-b border-border">
          <ul className="-mb-px flex gap-1 overflow-x-auto">
            {COMMUNICATIONS_LINKS.map((link) => (
              <li key={link.to}>
                <Link
                  to={link.to}
                  activeOptions={{ exact: link.exact, includeSearch: false }}
                  className="block border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:font-medium aria-[current=page]:text-primary"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    )
  },
})
