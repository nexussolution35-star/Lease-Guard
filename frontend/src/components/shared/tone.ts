import type { Tone } from '@/lib/labels'

/** Layout of a status, priority or verification label: plain text led by a dot or icon, no pill. */
export const STATUS_TEXT_CLASSES =
  'inline-flex h-5 shrink-0 items-center gap-1.5 align-top text-sm whitespace-nowrap [&>svg]:size-3.5 [&>svg]:shrink-0'

/** Solid fill per tone (dots, progress bars). Semantic tokens only. */
export const TONE_SOLID_CLASSES: Readonly<Record<Tone, string>> = {
  neutral: 'bg-muted-foreground',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  primary: 'bg-primary',
}

/** Foreground text colour per tone. */
export const TONE_TEXT_CLASSES: Readonly<Record<Tone, string>> = {
  neutral: 'text-muted-foreground',
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
  primary: 'text-primary',
}
