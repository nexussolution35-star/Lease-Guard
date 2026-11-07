import type { Tone } from '@/lib/labels'

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

/** Soft icon container per tone. */
export const TONE_SOFT_CLASSES: Readonly<Record<Tone, string>> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-destructive/10 text-destructive',
  primary: 'bg-primary/10 text-primary',
}
