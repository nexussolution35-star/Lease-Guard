import { useFormField } from '@/components/ui/form'
import { cn } from '@/lib/utils'

export interface FieldMessageProps {
  /** Component-level error (e.g. unparseable input) that takes priority over the RHF error. */
  override?: string | null
  className?: string
}

/** `FormMessage` variant with role="alert" and a local override message. */
export function FieldMessage({ override, className }: FieldMessageProps) {
  const { error, formMessageId } = useFormField()
  const body = override ?? (error ? String(error.message ?? '') : '')
  if (!body) return null
  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      role="alert"
      className={cn('text-sm text-destructive', className)}
    >
      {body}
    </p>
  )
}
