import { isApiError } from '@leaseguard/api-client'
import { OCCUPANCY_STATUSES, UNIT_TYPES, type Property, type Unit } from '@leaseguard/domain'
import { AlertCircle } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useForm, type Control } from 'react-hook-form'
import { toast } from 'sonner'

import { FormSection, NumberField, SelectField, TextAreaField, TextField, zodResolver, type FieldOption } from '@/components/forms'
import { FormDialog } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'
import { usePropertyList } from '@/features/properties/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'
import { enumOptions } from '@/lib/labels'

import { useCreateUnit, useUpdateUnit } from '../api/queries'
import {
  newUnitFormDefaults,
  newUnitFrom,
  unitChangesFrom,
  unitErrorField,
  unitFormDefaults,
  unitFormSchema,
  type UnitFormInput,
  type UnitFormValues,
} from '../unitFormSchema'

export interface UnitFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The unit to edit; omit to add one. */
  unit?: Unit
  /**
   * The unit's property. Given when adding from a property (it is preselected and fixed) and when editing (the
   * property cannot change). Omitted, the form offers the workspace's properties that are not archived.
   */
  property?: Pick<Property, 'id' | 'name'>
  /** Called with the saved unit after an add or edit. */
  onSaved?: (unit: Unit) => void
}

const TYPE_OPTIONS = enumOptions(UNIT_TYPES)
const OCCUPANCY_OPTIONS = enumOptions(OCCUPANCY_STATUSES)

/** The property select when the property is not given: the workspace's properties that are not archived, by name. */
function PropertyChoiceField({ control }: { control: Control<UnitFormInput, unknown, UnitFormValues> }) {
  const properties = usePropertyList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'name', direction: 'asc' })
  const options: FieldOption[] = (properties.data?.items ?? [])
    .filter((property) => property.status !== 'archived')
    .map((property) => ({ value: property.id, label: property.name }))
  return (
    <SelectField
      control={control}
      name="propertyId"
      label="Property"
      options={options}
      placeholder={properties.isPending ? 'Loading properties…' : 'Choose a property'}
      required
      className="sm:col-span-2"
    />
  )
}

/**
 * Add or edit a unit. The property is fixed once the unit exists; the tenant and lease are never typed in, they come
 * from the active lease. Every rule (unique unit number in the property, archived property, a leased unit stays
 * occupied) is enforced by the API; the form places its answer on the field it concerns.
 */
export function UnitFormDialog({ open, onOpenChange, unit, property, onSaved }: UnitFormDialogProps) {
  const isEdit = unit !== undefined
  const create = useCreateUnit()
  const update = useUpdateUnit()

  const defaults = useMemo(() => (unit ? unitFormDefaults(unit) : newUnitFormDefaults(property?.id)), [unit, property?.id])
  const form = useForm<UnitFormInput, unknown, UnitFormValues>({ resolver: zodResolver(unitFormSchema), defaultValues: defaults })
  const { reset } = form

  // Start from the saved unit (or an empty form in the given property) every time the dialog opens.
  useEffect(() => {
    if (open) reset(defaults)
  }, [open, defaults, reset])

  const rootError = form.formState.errors.root?.message

  const submit = form.handleSubmit(async (values) => {
    try {
      let saved: Unit
      if (unit) {
        const changes = unitChangesFrom(values, unit)
        if (changes === null) {
          toast.info('Nothing to save: the unit is unchanged.')
          onOpenChange(false)
          return
        }
        saved = await update.mutateAsync({ id: unit.id, changes })
        toast.success(`Unit ${saved.unitNumber} saved`)
      } else {
        saved = await create.mutateAsync(newUnitFrom(values))
        toast.success(`Unit ${saved.unitNumber} added`)
      }
      onOpenChange(false)
      onSaved?.(saved)
    } catch (error) {
      const message = describeApiError(error, 'The unit could not be saved. Try again.')
      const field = isApiError(error) ? unitErrorField(error.status, message) : null
      if (field) form.setError(field, { type: 'server', message }, { shouldFocus: true })
      else form.setError('root', { type: 'server', message })
    }
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? `Edit unit ${unit.unitNumber}` : 'Add unit'}
      description={isEdit ? 'Changes are recorded in the audit log.' : 'The unit is added to the property. Its property cannot be changed later.'}
      submitLabel={isEdit ? 'Save changes' : 'Add unit'}
      onSubmit={() => submit()}
      isPending={form.formState.isSubmitting}
    >
      <Form {...form}>
        {rootError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{rootError}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-6 pt-2">
          <FormSection title="Unit">
            {property ? (
              <SelectField
                control={form.control}
                name="propertyId"
                label="Property"
                options={[{ value: property.id, label: property.name }]}
                description={isEdit ? 'Fixed once the unit exists: leases and statements reference it.' : 'The unit is added to this property.'}
                disabled
                className="sm:col-span-2"
              />
            ) : (
              <PropertyChoiceField control={form.control} />
            )}
            <TextField control={form.control} name="unitNumber" label="Unit number" description="Unique within the property." placeholder="G12" maxLength={30} required />
            <SelectField control={form.control} name="type" label="Unit type" options={TYPE_OPTIONS} required />
            <NumberField control={form.control} name="floorAreaSqm" label="Floor area" suffix="m²" min={0} step={1} required />
            <TextField control={form.control} name="floor" label="Floor" placeholder="Ground" maxLength={50} />
            <SelectField
              control={form.control}
              name="occupancyStatus"
              label="Occupancy"
              options={OCCUPANCY_OPTIONS}
              {...(unit?.currentLeaseId ? { description: 'This unit has a current lease, so it stays occupied until the lease ends.' } : {})}
              required
            />
            <TextAreaField control={form.control} name="description" label="Description" rows={3} maxLength={2000} className="sm:col-span-2" />
          </FormSection>
        </div>
      </Form>
    </FormDialog>
  )
}
