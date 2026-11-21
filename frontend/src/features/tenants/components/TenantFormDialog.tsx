import { isApiError } from '@leaseguard/api-client'
import { BUSINESS_TYPES, TENANT_STATUSES, type Tenant } from '@leaseguard/domain'
import { AlertCircle } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { FormSection, SelectField, TextAreaField, TextField, zodResolver } from '@/components/forms'
import { FormDialog } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'
import { describeApiError } from '@/lib/data/apiErrors'
import { enumOptions } from '@/lib/labels'

import { useCreateTenant, useUpdateTenant } from '../api/queries'
import {
  newTenantFormDefaults,
  newTenantFrom,
  tenantChangesFrom,
  tenantErrorField,
  tenantFormDefaults,
  tenantFormSchema,
  type TenantFormInput,
  type TenantFormValues,
} from '../tenantFormSchema'

export interface TenantFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The tenant to edit; omit to create one. */
  tenant?: Tenant
  /** Called with the saved tenant after a create or edit. */
  onSaved?: (tenant: Tenant) => void
}

const BUSINESS_TYPE_OPTIONS = enumOptions(BUSINESS_TYPES)
const STATUS_OPTIONS = enumOptions(TENANT_STATUSES)

/**
 * Create or edit a tenant. The WhatsApp number is checked as it is typed out (the same rule as the API) and stored in
 * E.164; a new number, and any changed one, stays unvalidated until a writer validates it on the tenant's page.
 */
export function TenantFormDialog({ open, onOpenChange, tenant, onSaved }: TenantFormDialogProps) {
  const isEdit = tenant !== undefined
  const create = useCreateTenant()
  const update = useUpdateTenant()

  const form = useForm<TenantFormInput, unknown, TenantFormValues>({
    resolver: zodResolver(tenantFormSchema),
    defaultValues: tenant ? tenantFormDefaults(tenant) : newTenantFormDefaults(),
  })
  const { reset } = form

  // Start from the saved tenant (or an empty form) every time the dialog opens.
  useEffect(() => {
    if (open) reset(tenant ? tenantFormDefaults(tenant) : newTenantFormDefaults())
  }, [open, tenant, reset])

  const rootError = form.formState.errors.root?.message

  const submit = form.handleSubmit(async (values) => {
    try {
      let saved: Tenant
      if (tenant) {
        const changes = tenantChangesFrom(values, tenant)
        if (changes === null) {
          toast.info('Nothing to save: the tenant is unchanged.')
          onOpenChange(false)
          return
        }
        saved = await update.mutateAsync({ id: tenant.id, changes })
        toast.success(
          `${saved.tradingName} saved`,
          changes.whatsappNumber !== undefined ? { description: 'The new WhatsApp number must be validated before reminders are sent.' } : undefined,
        )
      } else {
        saved = await create.mutateAsync(newTenantFrom(values))
        toast.success(`${saved.tradingName} added`, { description: 'Validate the WhatsApp number on the tenant’s page before reminders are sent.' })
      }
      onOpenChange(false)
      onSaved?.(saved)
    } catch (error) {
      const placed = isApiError(error) ? tenantErrorField(error.status, error.messages) : null
      if (placed) form.setError(placed.field, { type: 'server', message: placed.message }, { shouldFocus: true })
      else form.setError('root', { type: 'server', message: describeApiError(error, 'The tenant could not be saved. Try again.') })
    }
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? `Edit ${tenant.tradingName}` : 'Add tenant'}
      description={isEdit ? 'Changes are recorded in the audit log.' : 'The tenant is added to this workspace. Link it to a unit through its lease.'}
      submitLabel={isEdit ? 'Save changes' : 'Add tenant'}
      onSubmit={() => submit()}
      isPending={form.formState.isSubmitting}
      size="lg"
    >
      <Form {...form}>
        {rootError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{rootError}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-6 pt-2">
          <FormSection title="Business">
            <TextField control={form.control} name="legalName" label="Registered name" maxLength={200} required className="sm:col-span-2" />
            <TextField
              control={form.control}
              name="tradingName"
              label="Trading name"
              description="The registered name when left empty."
              maxLength={200}
              className="sm:col-span-2"
            />
            <SelectField control={form.control} name="businessType" label="Business type" options={BUSINESS_TYPE_OPTIONS} required />
            <SelectField control={form.control} name="status" label="Status" options={STATUS_OPTIONS} required />
            <TextField control={form.control} name="registrationNumber" label="Registration number" maxLength={50} />
            <TextField control={form.control} name="vatNumber" label="VAT number" inputMode="numeric" maxLength={20} />
            <TextField control={form.control} name="industry" label="Industry" maxLength={100} />
            <TextField control={form.control} name="email" label="Accounts email" type="email" autoComplete="off" maxLength={254} />
          </FormSection>
          <FormSection title="WhatsApp" description="Statements and payment reminders go to this number once it is validated.">
            <TextField
              control={form.control}
              name="whatsappNumber"
              label="WhatsApp number"
              description={
                isEdit
                  ? 'Changing the number turns automated reminders off until the new number is validated.'
                  : 'With the country code, for example +27 82 123 4567. A South African number may start with 0.'
              }
              placeholder="+27 82 123 4567"
              inputMode="tel"
              type="tel"
              autoComplete="off"
              maxLength={30}
              required
              className="sm:col-span-2"
            />
          </FormSection>
          <FormSection title="Contact person">
            <TextField control={form.control} name="contactFullName" label="Full name" maxLength={200} required />
            <TextField control={form.control} name="contactRole" label="Role" placeholder="Financial manager" maxLength={100} />
            <TextField
              control={form.control}
              name="contactPhone"
              label="Phone"
              description="The WhatsApp number when left empty."
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={30}
            />
            <TextField control={form.control} name="contactEmail" label="Email" type="email" autoComplete="off" maxLength={254} />
          </FormSection>
          <FormSection title="Notes">
            <TextAreaField control={form.control} name="notes" label="Notes" rows={3} maxLength={2000} className="sm:col-span-2" />
          </FormSection>
        </div>
      </Form>
    </FormDialog>
  )
}
