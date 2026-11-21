import { USER_ROLES } from '@leaseguard/domain'
import { Check } from 'lucide-react'
import { useId } from 'react'

import { SETTINGS_ROW_GRID_COMPACT } from '@/components/forms'
import { PageHeader } from '@/components/layout/PageHeader'
import { AppLink } from '@/components/shared'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useActiveRole, useIsCompanyAdmin } from '@/features/account/useActiveRole'
import { labelFor } from '@/lib/labels'
import { cn } from '@/lib/utils'

import { ROLE_CAPABILITIES } from '../rolePermissions'
import { ROLE_DESCRIPTIONS } from '../roles'

/**
 * Settings → Roles: what each role can see and do in a workspace, with the signed-in user's role
 * marked. Roles are fixed; a company admin gives someone a role in Settings → Users. The screen
 * explains the rules; the API and the database enforce them.
 */
/** Capabilities grouped by area, areas in order of first appearance, so each area is named once. */
const CAPABILITY_GROUPS = ROLE_CAPABILITIES.reduce<{ area: string; capabilities: (typeof ROLE_CAPABILITIES)[number][] }[]>((groups, capability) => {
  const group = groups.find((g) => g.area === capability.area)
  if (group) group.capabilities.push(capability)
  else groups.push({ area: capability.area, capabilities: [capability] })
  return groups
}, [])

export function RolesSettingsScreen() {
  const activeRole = useActiveRole()
  const isAdmin = useIsCompanyAdmin()
  const matrixId = useId()

  return (
    <section>
      <PageHeader title="Roles" description="What each role can see and do in this workspace. Everyone only ever sees their own company's records." />
      <div className="flex flex-col gap-8">
        <dl className="divide-y divide-border">
          {USER_ROLES.map((role) => (
            <div key={role} className={cn(SETTINGS_ROW_GRID_COMPACT, 'gap-y-1 py-3 text-sm first:pt-0')}>
              <dt className="flex flex-wrap items-baseline gap-x-2 font-medium text-foreground">
                {labelFor(role)}
                {role === activeRole ? <span className="text-xs font-normal text-muted-foreground">Your role</span> : null}
              </dt>
              <dd className="text-foreground">{ROLE_DESCRIPTIONS[role]}</dd>
            </div>
          ))}
        </dl>
        <section aria-labelledby={matrixId} className="space-y-4">
          <div className="space-y-1">
            <h2 id={matrixId} className="text-base font-medium text-balance text-foreground">
              Permissions
            </h2>
            <p className="text-sm text-muted-foreground">
              Roles are the same in every workspace and cannot be customised.{' '}
              {isAdmin ? (
                <>
                  Change someone's role in{' '}
                  <AppLink to="/settings/users" className="font-medium text-primary underline-offset-4 hover:underline">
                    Settings → Users
                  </AppLink>
                  .
                </>
              ) : (
                'A company admin can change your role.'
              )}
            </p>
          </div>
          <div className="border-y border-border">
            <Table>
              <TableCaption className="sr-only">What each role can do</TableCaption>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col" className="min-w-48 sm:min-w-64">
                    Permission
                  </TableHead>
                  {USER_ROLES.map((role) => (
                    <TableHead key={role} scope="col" className={cn('text-center font-normal', role === activeRole && 'bg-primary/5 font-medium text-foreground')}>
                      {labelFor(role)}
                      {role === activeRole ? <span className="sr-only"> (your role)</span> : null}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {CAPABILITY_GROUPS.flatMap(({ area, capabilities }) => [
                  <TableRow key={`area-${area}`} className="hover:bg-transparent">
                    <TableHead scope="colgroup" colSpan={USER_ROLES.length + 1} className="h-auto pt-5 pb-1.5 text-xs font-normal text-muted-foreground">
                      {area}
                    </TableHead>
                  </TableRow>,
                  ...capabilities.map((capability) => (
                  <TableRow key={capability.id}>
                    <TableHead scope="row" className="py-2.5 text-sm font-normal whitespace-normal text-foreground">
                      {capability.label}
                    </TableHead>
                    {USER_ROLES.map((role) => {
                      const allowed = capability.allows(role)
                      return (
                        <TableCell key={role} className={cn('text-center', role === activeRole && 'bg-primary/5')}>
                          {allowed ? <Check className="inline size-4 text-foreground" aria-hidden="true" /> : null}
                          <span className="sr-only">{allowed ? 'Yes' : 'No'}</span>
                        </TableCell>
                      )
                    })}
                  </TableRow>
                  )),
                ])}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </section>
  )
}
