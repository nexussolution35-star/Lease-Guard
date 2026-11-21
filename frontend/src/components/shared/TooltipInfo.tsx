import { Info } from 'lucide-react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface TooltipInfoProps {
  content: ReactNode
  /** Accessible name for the trigger. Default `More information`. */
  label?: string
  className?: string
}

const HOVER_CLOSE_DELAY_MS = 150

/**
 * An "i" toggletip. Click, tap or Enter opens it (a tooltip would never open on touch, and this carries
 * information people need); Esc and an outside click close it. A mouse hover still previews it, and the
 * pointer can move onto the bubble without it closing.
 */
export function TooltipInfo({ content, label = 'More information', className }: TooltipInfoProps) {
  const [open, setOpen] = useState(false)
  // Opened by hover: it closes when the pointer leaves and does not take focus.
  const [byHover, setByHover] = useState(false)
  const closeTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  function cancelClose() {
    window.clearTimeout(closeTimer.current)
  }
  function scheduleClose() {
    if (!byHover) return
    cancelClose()
    closeTimer.current = window.setTimeout(() => {
      setOpen(false)
      setByHover(false)
    }, HOVER_CLOSE_DELAY_MS)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        cancelClose()
        // A click on a hover-opened bubble pins it open rather than closing it.
        if (!next && byHover) {
          setByHover(false)
          return
        }
        setByHover(false)
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onPointerEnter={(event) => {
            if (event.pointerType !== 'mouse') return
            cancelClose()
            if (!open) {
              setByHover(true)
              setOpen(true)
            }
          }}
          onPointerLeave={scheduleClose}
          className={cn(
            'inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden',
            className,
          )}
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        sideOffset={0}
        aria-label={label}
        onOpenAutoFocus={(event) => {
          if (byHover) event.preventDefault()
        }}
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
        className="w-fit max-w-xs rounded-md border-0 bg-foreground px-3 py-1.5 text-xs text-balance text-background shadow-none"
      >
        {content}
        <PopoverPrimitive.Arrow className="fill-foreground" width={10} height={5} />
      </PopoverContent>
    </Popover>
  )
}
