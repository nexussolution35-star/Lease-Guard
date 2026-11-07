import type { ReactNode } from 'react'

import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

export interface DetailDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  /** Default `right`. */
  side?: 'right' | 'bottom'
  className?: string
}

export function DetailDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = 'right',
  className,
}: DetailDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        className={cn(
          'gap-0',
          side === 'right' ? 'w-full sm:max-w-lg' : 'max-h-[85vh] rounded-t-xl',
          className,
        )}
      >
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : <SheetDescription className="sr-only">{title}</SheetDescription>}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? (
          <SheetFooter className="border-t border-border sm:flex-row sm:justify-end">{footer}</SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
