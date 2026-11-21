import { canChooseUnitForAssignment, unitAssignmentAvailability, type PropertyStatus, type UnitListItem } from '@leaseguard/domain'
import { AlertCircle } from 'lucide-react'
import { useEffect } from 'react'
import { useForm, type Control } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { SelectField, zodResolver, type FieldOption } from '@/components/forms'
import { FormDialog } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'
import { useTenantList } from '@/features/tenants/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'

import { useAssignTenantToUnit } from '../api/queries'

export interface AssignTenantDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The unit to assign, with its current tenant and lease as listed. */
  unit: Pick<UnitListItem, 'id' | 'unitNumber'> & Partial<Pick<UnitListItem, 'currentTenant' | 'currentLease' | 'currentAssignment'>>
  propertyStatus: PropertyStatus | undefined
}

const schema = z.object({ tenantId: z.string().min(1, 'Choose a tenant') })
type Values = z.infer<typeof schema>

/** The tenant choice; mounted only while the dialog is open, so nothing is fetched for a closed dialog. */
function TenantChoiceField({
  control,
  unit,
  propertyStatus,
}: {
  control: Control<Values>
  unit: AssignTenantDialogProps['unit']
  propertyStatus: PropertyStatus | undefined
}) {
  const tenants = useTenantList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'tradingName', direction: 'asc' })
  const tenantOptions: FieldOption[] = (tenants.data?.items ?? []).map((tenant) => {
    const choosable = canChooseUnitForAssignment(unitAssignmentAvailability(unit, tenant.id, propertyStatus))
    return { value: tenant.id, label: tenant.tradingName, ...(choosable ? {} : { disabled: true }) }
  })
  return (
    <div className="pt-2">
      <SelectField
        control={control}
        name="tenantId"
        label="Tenant"
        options={tenantOptions}
        placeholder={tenants.isPending ? 'Loading tenants…' : 'Choose a tenant'}
        required
      />
    </div>
  )
}

/**
 * Assign a tenant to this unit without a lease. While the unit's active lease is a tenant's, only that tenant can be
 * chosen (domain `unitAssignmentAvailability`); the database decides and names who holds the unit when it refuses.
 */
export function AssignTenantDialog({ open, onOpenChange, unit, propertyStatus }: AssignTenantDialogProps) {
  const assign = useAssignTenantToUnit()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { tenantId: '' } })
  const { reset } = form

  useEffect(() => {
    if (open) reset({ tenantId: '' })
  }, [open, reset])

  const submit = form.handleSubmit(async (values) => {
    try {
      const saved = await assign.mutateAsync({ tenantId: values.tenantId, unitId: unit.id })
      toast.success(`${saved.tenantName} assigned to unit ${saved.unitNumber}`, { description: 'The unit is now occupied.' })
      onOpenChange(false)
    } catch (error) {
      form.setError('root', { type: 'server', message: describeApiError(error, 'The tenant could not be assigned. Try again.') })
    }
  })

  const rootError = form.formState.errors.root?.message

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Assign a tenant to unit ${unit.unitNumber}`}
      description={
        unit.currentLease && unit.currentTenant
          ? `The unit is let to ${unit.currentTenant.tradingName} (${unit.currentLease.reference}); only that tenant can be assigned while the lease is in place.`
          : 'Without a lease. The unit is occupied by the tenant straight away; a lease added for it later must be for this tenant.'
      }
      submitLabel="Assign tenant"
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
        <TenantChoiceField control={form.control} unit={unit} propertyStatus={propertyStatus} />
      </Form>
    </FormDialog>
  )
}
