import { EmptyState } from './EmptyState'

export interface NoActiveWorkspaceProps {
  className?: string
}

/** Shown instead of company data while no workspace is selected (before `GET /me` has loaded the memberships). */
export function NoActiveWorkspace({ className }: NoActiveWorkspaceProps) {
  return (
    <EmptyState
      title="No workspace selected"
      description="LeaseGuard could not determine which company workspace to show. Contact your administrator if this persists."
      {...(className ? { className } : {})}
    />
  )
}
