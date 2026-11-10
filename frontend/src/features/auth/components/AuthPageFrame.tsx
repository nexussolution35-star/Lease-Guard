import { ShieldCheck, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

export interface AuthPageFrameProps {
  /** The page's level-1 heading. */
  title: string
  description?: ReactNode
  icon?: LucideIcon
  children?: ReactNode
  /** Secondary links under the card body, e.g. "Back to sign in". */
  footer?: ReactNode
}

/** Full-page card for the screens outside the application shell (sign-in, password and invitation pages). */
export function AuthPageFrame({ title, description, icon: Icon = ShieldCheck, children, footer }: AuthPageFrameProps) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-10 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader className="gap-3">
          <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <CardTitle>
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            </CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
        </CardHeader>
        {children ? <CardContent className="flex flex-col gap-4">{children}</CardContent> : null}
        {footer ? <CardFooter className="flex flex-wrap gap-x-4 gap-y-2 text-sm">{footer}</CardFooter> : null}
      </Card>
    </main>
  )
}
