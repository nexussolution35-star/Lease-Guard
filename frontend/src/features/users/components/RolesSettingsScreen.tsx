import { USER_ROLES } from '@leaseguard/domain'
import { Check, Minus } from 'lucide-react'
import { useId } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { AppLink } from '@/components/shared'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
export function RolesSettingsScreen() {
  const activeRole = useActiveRole()
  const isAdmin = useIsCompanyAdmin()
  const matrixId = useId()

  return (
    <section className="space-y-6">
      <PageHeader
        title="Roles"
        description="What each role can see and do in this workspace. Everyone only ever sees their own company's records."
        className="pb-0"
      />
      <ul className="grid gap-4 sm:grid-cols-2">
        {USER_ROLES.map((role) => (
          <li key={role}>
            <Card className={cn('h-full', role === activeRole && 'border-primary')}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {labelFor(role)}
                  {role === activeRole ? <Badge variant="secondary">Your role</Badge> : null}
                </CardTitle>
                <CardDescription>{ROLE_DESCRIPTIONS[role]}</CardDescription>
              </CardHeader>
            </Card>
          </li>
        ))}
      </ul>
      <Card role="region" aria-labelledby={matrixId}>
        <CardHeader>
          <CardTitle id={matrixId} className="text-base">
            Permissions
          </CardTitle>
          <CardDescription>
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
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableCaption className="sr-only">What each role can do</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className="min-w-64">
                    Permission
                  </TableHead>
                  {USER_ROLES.map((role) => (
                    <TableHead key={role} scope="col" className={cn('text-center whitespace-nowrap', role === activeRole && 'text-primary')}>
                      {labelFor(role)}
                      {role === activeRole ? <span className="sr-only"> (your role)</span> : null}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {ROLE_CAPABILITIES.map((capability) => (
                  <TableRow key={capability.id}>
                    <TableHead scope="row" className="py-3 font-normal whitespace-normal text-foreground">
                      <span className="block text-xs text-muted-foreground">{capability.area}</span>
                      {capability.label}
                    </TableHead>
                    {USER_ROLES.map((role) => {
                      const allowed = capability.allows(role)
                      return (
                        <TableCell key={role} className={cn('text-center', role === activeRole && 'bg-primary/5')}>
                          <span className={cn('inline-flex items-center gap-1 text-sm', allowed ? 'font-medium text-success' : 'text-muted-foreground')}>
                            {allowed ? <Check className="size-4" aria-hidden="true" /> : <Minus className="size-4" aria-hidden="true" />}
                            {allowed ? 'Yes' : 'No'}
                          </span>
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
