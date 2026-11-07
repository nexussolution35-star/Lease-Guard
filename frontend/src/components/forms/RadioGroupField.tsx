import type { FieldPath, FieldValues } from 'react-hook-form'
import {
  FormControl,
  FormDescription,
  FormField as RHFFormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'
import { fieldIdFor } from './fieldId'
import type { FieldOption } from './options'
import { RequiredIndicator } from './RequiredIndicator'
import type { BaseFieldProps } from './types'

export interface RadioGroupFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  T extends string = string,
> extends BaseFieldProps<TFieldValues, TName> {
  options: readonly FieldOption<T>[]
  orientation?: 'vertical' | 'horizontal'
}

/** Radio group labelled by a group label; each option may carry a description. */
export function RadioGroupField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  T extends string = string,
>({
  control,
  name,
  label,
  description,
  required = false,
  disabled = false,
  id,
  className,
  options,
  orientation = 'vertical',
}: RadioGroupFieldProps<TFieldValues, TName, T>) {
  const controlId = id ?? fieldIdFor(name)
  const labelId = `${controlId}-label`
  return (
    <RHFFormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem className={className}>
          <p
            id={labelId}
            data-error={!!fieldState.error}
            className="flex items-center gap-2 text-sm leading-none font-medium select-none data-[error=true]:text-destructive"
          >
            {label}
            {required ? <RequiredIndicator /> : null}
          </p>
          <FormControl id={controlId}>
            <RadioGroup
              ref={field.ref}
              name={field.name}
              value={typeof field.value === 'string' ? field.value : ''}
              onValueChange={(next) => field.onChange(next as T)}
              onBlur={field.onBlur}
              disabled={disabled}
              orientation={orientation}
              aria-labelledby={labelId}
              aria-required={required || undefined}
              className={cn(
                orientation === 'horizontal' ? 'flex flex-wrap gap-x-6 gap-y-3' : 'grid gap-3',
              )}
            >
              {options.map((option) => {
                const itemId = `${controlId}-${option.value}`
                const descriptionId = option.description ? `${itemId}-description` : undefined
                return (
                  <div key={option.value} className="flex items-start gap-3">
                    <RadioGroupItem
                      id={itemId}
                      value={option.value}
                      disabled={option.disabled}
                      aria-describedby={descriptionId}
                      className="mt-0.5"
                    />
                    <div className="grid gap-1">
                      <Label htmlFor={itemId} className="font-normal">
                        {option.label}
                      </Label>
                      {option.description ? (
                        <p id={descriptionId} className="text-sm text-muted-foreground">
                          {option.description}
                        </p>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </RadioGroup>
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage role="alert" />
        </FormItem>
      )}
    />
  )
}
