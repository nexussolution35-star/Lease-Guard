import { Info } from 'lucide-react'
import type { ReactNode } from 'react'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface TooltipInfoProps {
  content: ReactNode
  /** Accessible name for the trigger. Default `More information`. */
  label?: string
  className?: string
}

export function TooltipInfo({ content, label = 'More information', className }: TooltipInfoProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn(
              'inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              className,
            )}
          >
            <Info className="size-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{content}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
