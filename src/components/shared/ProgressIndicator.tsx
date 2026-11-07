import { Progress } from '@/components/ui/progress'
import type { Tone } from '@/lib/labels'
import { cn } from '@/lib/utils'

export interface ProgressIndicatorProps {
  /** 0–100; clamped. */
  value: number
  label: string
  /** Show the percentage next to the label. Default true. */
  showValue?: boolean
  tone?: Tone
  className?: string
}

const INDICATOR_CLASSES: Readonly<Record<Tone, string>> = {
  neutral: '[&>[data-slot=progress-indicator]]:bg-muted-foreground bg-muted',
  info: '[&>[data-slot=progress-indicator]]:bg-info bg-info/20',
  success: '[&>[data-slot=progress-indicator]]:bg-success bg-success/20',
  warning: '[&>[data-slot=progress-indicator]]:bg-warning bg-warning/20',
  danger: '[&>[data-slot=progress-indicator]]:bg-destructive bg-destructive/20',
  primary: '[&>[data-slot=progress-indicator]]:bg-primary bg-primary/20',
}

export function ProgressIndicator({ value, label, showValue = true, tone = 'primary', className }: ProgressIndicatorProps) {
  const clamped = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0
  const rounded = Math.round(clamped)
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        {showValue ? <span className="font-medium tabular-nums text-foreground">{rounded}%</span> : null}
      </div>
      <Progress value={clamped} aria-label={label} aria-valuetext={`${rounded}%`} className={INDICATOR_CLASSES[tone]} />
    </div>
  )
}
