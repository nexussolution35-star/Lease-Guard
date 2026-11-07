import type { Control, FieldPath, FieldValues } from 'react-hook-form'

/** Props shared by every react-hook-form aware field component. */
export interface BaseFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> {
  control: Control<TFieldValues>
  name: TName
  label: string
  description?: string
  required?: boolean
  disabled?: boolean
  /** Override the generated DOM id (defaults to `fieldIdFor(name)`). */
  id?: string
  className?: string
}

/** Props injected by the shadcn `FormControl` Slot onto the control element. */
export interface SlotA11yProps {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}
