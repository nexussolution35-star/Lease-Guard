import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { BrandMark } from '@/components/shared'

export interface AuthPageFrameProps {
  /** The page's level-1 heading. */
  title: string
  description?: ReactNode
  /** Accepted for compatibility; the frame shows no per-page icon. */
  icon?: LucideIcon
  children?: ReactNode
  /** Secondary links under the form, e.g. "Back to sign in". */
  footer?: ReactNode
}

/**
 * The frame for the screens outside the application shell (sign-in, password and invitation pages).
 * On wide screens the ink-blue rail carries the brand beside a white work area, as in the signed-in
 * shell; on a phone the form stands alone under the mark. Sections are ruled with hairlines, not boxed.
 */
export function AuthPageFrame({ title, description, children, footer }: AuthPageFrameProps) {
  return (
    <div className="grid min-h-svh bg-background text-foreground lg:grid-cols-[minmax(20rem,26rem)_1fr]">
      <aside className="rail hidden flex-col justify-between px-8 py-8 lg:flex">
        <BrandMark />
        <p className="max-w-[18rem] text-sm text-pretty text-muted-foreground">Lease monitoring and tenant communication</p>
      </aside>
      <main className="flex flex-col px-4 py-8 sm:px-8 lg:justify-center lg:px-16 lg:pt-12 lg:pb-32">
        <div className="flex w-full max-w-sm flex-col gap-6 sm:mx-auto lg:mx-0">
          <p className="mb-4 lg:hidden">
            <BrandMark />
          </p>
          <header className="flex flex-col gap-2">
            <h1 className="text-xl font-medium text-balance">{title}</h1>
            {description ? <p className="text-sm text-pretty text-muted-foreground">{description}</p> : null}
          </header>
          {children ? <div className="flex flex-col gap-4">{children}</div> : null}
          {footer ? <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4 text-sm">{footer}</div> : null}
        </div>
      </main>
    </div>
  )
}
