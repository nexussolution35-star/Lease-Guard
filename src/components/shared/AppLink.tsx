import { Link } from '@tanstack/react-router'
import type { ComponentProps } from 'react'

export interface AppLinkProps extends Omit<ComponentProps<'a'>, 'href'> {
  /** Application path, e.g. `/leases/lease_0001`. Typed as string so shared components can accept hrefs. */
  to: string
}

/**
 * Thin wrapper around TanStack Router's `Link` that accepts a plain string path.
 * Route paths are generated types; shared components receive hrefs as strings, so the cast lives here.
 */
export function AppLink({ to, ...props }: AppLinkProps) {
  return <Link to={to as never} {...props} />
}
