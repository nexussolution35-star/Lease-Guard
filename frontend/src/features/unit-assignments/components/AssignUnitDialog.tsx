import type { Tenant } from '@leaseguard/domain'
import { AlertCircle } from 'lucide-react'
import { useEffect } from 'react'
import { useForm, useWatch, type Control } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { SelectField, zodResolver } from '@/components/forms'
import { FormDialog } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'
import { describeApiError } from '@/lib/data/apiErrors'

import { useAssignTenantToUnit } from '../api/queries'
import { useAssignableUnitOptions } from './useAssignableUnitOptions'

export interface AssignUnitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The tenant to assign. */
  tenant: Tenant
}

const schema = z.object({
  propertyId: z.string().min(1, 'Choose a property'),
  unitId: z.string().min(1, 'Choose a unit'),
})
type Values = z.infer<typeof schema>
const EMPTY: Values = { propertyId: '', unitId: '' }

/** Property, then unit; mounted only while the dialog is open, so nothing is fetched for a closed dialog. */
function UnitChoiceFields({ control, tenantId }: { control: Control<Values>; tenantId: string }) {
  const propertyId = useWatch({ control, name: 'propertyId' })
  const options = useAssignableUnitOptions(propertyId || undefined, tenantId)
  return (
    <div className="grid gap-4 pt-2 sm:grid-cols-2">
      <SelectField
        control={control}
        name="propertyId"
        label="Property"
        options={options.propertyOptions}
        placeholder={options.propertiesPending ? 'Loading properties…' : 'Choose a property'}
        required
      />
      <SelectField
        control={control}
        name="unitId"
        label="Unit"
        options={options.unitOptions}
        placeholder={!propertyId ? 'Choose the property first' : options.unitsPending ? 'Loading units…' : 'Choose a unit'}
        disabled={!propertyId}
        required
      />
    </div>
  )
}

/**
 * Assign the tenant to a unit without a lease: choose the property, then one of its units. The unit is occupied by the
 * tenant straight away. A refusal (the unit is let or assigned to someone else, or the property is archived) comes from
 * the database and names who holds the unit.
 */
export function AssignUnitDialog({ open, onOpenChange, tenant }: AssignUnitDialogProps) {
  const assign = useAssignTenantToUnit()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY })
  const { reset, setValue, subscribe } = form

  useEffect(() => {
    if (open) reset(EMPTY)
  }, [open, reset])

  // Another property means another unit: the chosen unit belongs to the previous property.
  useEffect(
    () =>
      subscribe({
        name: 'propertyId',
        formState: { values: true },
        callback: ({ type }) => {
          if (type === 'change') setValue('unitId', '')
        },
      }),
    [subscribe, setValue],
  )

  const submit = form.handleSubmit(async (values) => {
    try {
      const saved = await assign.mutateAsync({ tenantId: tenant.id, unitId: values.unitId })
      toast.success(`${saved.tenantName} assigned to unit ${saved.unitNumber}`, { description: `${saved.propertyName}. The unit is now occupied.` })
      onOpenChange(false)
    } catch (error) {
      form.setError('root', { type: 'server', message: describeApiError(error, 'The unit could not be assigned. Try again.') })
    }
  })

  const rootError = form.formState.errors.root?.message

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Assign ${tenant.tradingName} to a unit`}
      description="Without a lease. The unit is occupied by the tenant straight away; a lease added for it later must be for this tenant. Monitoring still runs only from verified leases."
      submitLabel="Assign to unit"
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
        <UnitChoiceFields control={form.control} tenantId={tenant.id} />
      </Form>
    </FormDialog>
  )
}
