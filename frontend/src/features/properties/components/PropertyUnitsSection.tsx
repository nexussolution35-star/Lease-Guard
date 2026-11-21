import { unitTypeMatchesProperty, unitTypesForProperty, type PropertyType } from '@leaseguard/domain'
import { Link } from '@tanstack/react-router'
import { Plus, X } from 'lucide-react'
import { useEffect } from 'react'
import { useFieldArray, useWatch, type Control, type UseFormGetValues, type UseFormSetValue } from 'react-hook-form'

import { FormSection, NumberField, SelectField, TextField } from '@/components/forms'
import { Button } from '@/components/ui/button'
import { enumOptions } from '@/lib/labels'

import { MAX_NEW_PROPERTY_UNITS, newPropertyUnitDefaults, type PropertyFormInput, type PropertyFormValues } from '../propertyFormSchema'

const AREA_FORMAT = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 2 })

export interface PropertyUnitsSectionProps {
  control: Control<PropertyFormInput, unknown, PropertyFormValues>
  getValues: UseFormGetValues<PropertyFormInput>
  setValue: UseFormSetValue<PropertyFormInput>
}

/**
 * Units added together with a new property. The type list offers only unit types that suit the chosen property
 * type, and a unit whose type stops matching (the property type changed) moves to the most usual matching type.
 */
export function PropertyUnitsSection({ control, getValues, setValue }: PropertyUnitsSectionProps) {
  const units = useFieldArray({ control, name: 'units' })
  const [propertyType, rows, gla] = useWatch({ control, name: ['type', 'units', 'grossLettableAreaSqm'] })
  const chosenType = (propertyType || undefined) as PropertyType | undefined
  const typeOptions = enumOptions(unitTypesForProperty(chosenType))

  useEffect(() => {
    if (!chosenType) return
    const fallback = unitTypesForProperty(chosenType)[0]
    // Only a property type change re-types the rows, so the rows are read here rather than watched.
    getValues('units').forEach((row, index) => {
      if (fallback && (!row.type || !unitTypeMatchesProperty(row.type, chosenType))) {
        setValue(`units.${index}.type`, fallback, { shouldDirty: true, shouldValidate: Boolean(row.type) })
      }
    })
  }, [chosenType, getValues, setValue])

  const count = units.fields.length
  const totalArea = (rows ?? []).reduce((sum, row) => sum + (Number.isFinite(row.floorAreaSqm) ? row.floorAreaSqm : 0), 0)
  const full = count >= MAX_NEW_PROPERTY_UNITS

  return (
    <FormSection
      title="Units"
      columns={1}
      description="Optional. Each unit is added as vacant once the property is saved."
    >
      {count > 0 ? (
        <ol className="divide-y divide-border border-y" aria-label="Units to add">
          {units.fields.map((field, index) => (
            <li key={field.id} className="grid grid-cols-2 items-start gap-x-3 gap-y-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto]">
              <TextField control={control} name={`units.${index}.unitNumber`} label="Unit number" placeholder="G01" maxLength={30} required />
              <SelectField control={control} name={`units.${index}.type`} label="Unit type" options={typeOptions} placeholder="Choose a type" required />
              <NumberField control={control} name={`units.${index}.floorAreaSqm`} label="Floor area" suffix="m²" min={0} step={1} required />
              <TextField control={control} name={`units.${index}.floor`} label="Floor" placeholder="Ground" maxLength={50} />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="col-span-2 justify-self-end sm:col-span-1 sm:mt-6"
                aria-label={`Remove unit ${index + 1}`}
                onClick={() => units.remove(index)}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Button type="button" variant="outline" size="sm" disabled={full} onClick={() => units.append(newPropertyUnitDefaults(chosenType))}>
          <Plus aria-hidden="true" />
          Add unit
        </Button>
        <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
          {count === 0 ? (
            <>
              Many units?{' '}
              <Link to="/properties/import" className="font-medium text-foreground underline underline-offset-4">
                Import a file
              </Link>
            </>
          ) : (
            <>
              {count} {count === 1 ? 'unit' : 'units'}, {AREA_FORMAT.format(totalArea)} m²
              {Number.isFinite(gla) && gla > 0 ? ` of ${AREA_FORMAT.format(gla)} m² lettable` : ''}
            </>
          )}
        </p>
      </div>
    </FormSection>
  )
}
