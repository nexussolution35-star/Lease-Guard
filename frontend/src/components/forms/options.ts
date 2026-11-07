/** Option shape shared by select, multi-select and radio fields. */
export interface FieldOption<T extends string = string> {
  value: T
  label: string
  disabled?: boolean
  /** Secondary text (rendered by `RadioGroupField`). */
  description?: string
}
