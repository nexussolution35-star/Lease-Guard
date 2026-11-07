import { useForm } from 'react-hook-form'
import type { Control, DefaultValues, FieldValues, UseFormReturn } from 'react-hook-form'
import type { ReactNode } from 'react'
import { Form } from '@/components/ui/form'

export interface TestFormProps<T extends FieldValues> {
  defaultValues?: DefaultValues<T>
  onReady?: (form: UseFormReturn<T>) => void
  children: (control: Control<T>) => ReactNode
}

/** Minimal RHF form used by field component tests. */
export function TestForm<T extends FieldValues>({ defaultValues, onReady, children }: TestFormProps<T>) {
  const form = useForm<T>({ defaultValues })
  onReady?.(form)
  return (
    <Form {...form}>
      <form onSubmit={(e) => e.preventDefault()}>{children(form.control)}</form>
    </Form>
  )
}
