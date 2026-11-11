import { isApiError } from '@leaseguard/api-client'
import { PROPERTY_TYPES, SA_PROVINCES, STATEMENT_SOURCES, type Property } from '@leaseguard/domain'
import { AlertCircle } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { AddressAutocompleteField, FormSection, NumberField, SelectField, TextAreaField, TextField, zodResolver, type FieldOption } from '@/components/forms'
import { FormDialog } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'
import { useCurrentUserId } from '@/features/account/useActiveRole'
import { useMemberList } from '@/features/users/api/queries'
import type { CompanyMember } from '@/features/users/api/source'
import { describeApiError } from '@/lib/data/apiErrors'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'
import { enumOptions, labelFor } from '@/lib/labels'

import { useCreateProperty, useUpdateProperty } from '../api/queries'
import {
  EDITABLE_PROPERTY_STATUSES,
  NO_OWNER,
  newPropertyFormDefaults,
  newPropertyFrom,
  propertyChangesFrom,
  propertyErrorField,
  propertyFormDefaults,
  propertyFormSchema,
  type PropertyFormInput,
  type PropertyFormValues,
} from '../propertyFormSchema'

export interface PropertyFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The property to edit; omit to create one. */
  property?: Property
  /** Called with the saved property after a create or edit. */
  onSaved?: (property: Property) => void
}

const TYPE_OPTIONS = enumOptions(PROPERTY_TYPES)
const STATUS_OPTIONS = enumOptions(EDITABLE_PROPERTY_STATUSES)
const PROVINCE_OPTIONS = SA_PROVINCES.map((province) => ({ value: province, label: province }))
const ACCOUNTING_OPTIONS = STATEMENT_SOURCES.map((source) => ({ value: source, label: source === 'other' ? 'Other' : source }))
const MANAGER_ROLES: ReadonlySet<string> = new Set(['company_admin', 'property_manager'])

const roleOf = (member: CompanyMember) => member.memberships[0]?.role

function memberOption(member: CompanyMember): FieldOption {
  return { value: member.id, label: `${member.fullName} (${labelFor(roleOf(member))})` }
}

/**
 * Create or edit a property. The manager is a company admin or property manager of the workspace; the owner, if any,
 * a property owner (people listed as current manager or owner stay selectable). The code is set once, on create.
 */
export function PropertyFormDialog({ open, onOpenChange, property, onSaved }: PropertyFormDialogProps) {
  const isEdit = property !== undefined
  const currentUserId = useCurrentUserId()
  const create = useCreateProperty()
  const update = useUpdateProperty()
  const members = useMemberList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'fullName', direction: 'asc' }, { enabled: open })

  const form = useForm<PropertyFormInput, unknown, PropertyFormValues>({
    resolver: zodResolver(propertyFormSchema),
    defaultValues: property ? propertyFormDefaults(property) : newPropertyFormDefaults(currentUserId),
  })
  const { reset } = form

  // Start from the saved property (or an empty form) every time the dialog opens.
  useEffect(() => {
    if (open) reset(property ? propertyFormDefaults(property) : newPropertyFormDefaults(currentUserId))
  }, [open, property, currentUserId, reset])

  const { managerOptions, ownerOptions } = useMemo(() => {
    const loaded = members.data?.items ?? []
    // The property's current manager and owner stay selectable whatever their status, so the select shows who is
    // assigned; anyone else must be an active member with the right role.
    const options = (current: string | undefined, qualifies: (member: CompanyMember) => boolean, fallback: string): FieldOption[] => {
      const listed = loaded.filter((m) => m.id === current || (m.status === 'active' && qualifies(m))).map(memberOption)
      if (current && members.isSuccess && !listed.some((option) => option.value === current)) listed.unshift({ value: current, label: fallback })
      return listed
    }
    return {
      managerOptions: options(property?.managerUserId, (m) => MANAGER_ROLES.has(roleOf(m) ?? ''), 'Current manager'),
      ownerOptions: [{ value: NO_OWNER, label: 'No owner' }, ...options(property?.ownerUserId, (m) => roleOf(m) === 'property_owner', 'Current owner')],
    }
  }, [members.data, members.isSuccess, property?.managerUserId, property?.ownerUserId])

  const rootError = form.formState.errors.root?.message

  const submit = form.handleSubmit(async (values) => {
    try {
      let saved: Property
      if (property) {
        const changes = propertyChangesFrom(values, property)
        if (changes === null) {
          toast.info('Nothing to save: the property is unchanged.')
          onOpenChange(false)
          return
        }
        saved = await update.mutateAsync({ id: property.id, changes })
        toast.success(`${saved.name} saved`)
      } else {
        saved = await create.mutateAsync(newPropertyFrom(values))
        toast.success(`${saved.name} added`)
      }
      onOpenChange(false)
      onSaved?.(saved)
    } catch (error) {
      const message = describeApiError(error, 'The property could not be saved. Try again.')
      const field = isApiError(error) ? propertyErrorField(error.status, message) : null
      if (field) form.setError(field, { type: 'server', message }, { shouldFocus: true })
      else form.setError('root', { type: 'server', message })
    }
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? `Edit ${property.name}` : 'Add property'}
      description={isEdit ? 'Changes are recorded in the audit log.' : 'The property is added to this workspace. Its code cannot be changed later.'}
      submitLabel={isEdit ? 'Save changes' : 'Add property'}
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
        <div className="space-y-6">
          <FormSection title="Name, type and size">
            <TextField control={form.control} name="name" label="Name" maxLength={200} required className="sm:col-span-2" />
            <TextField
              control={form.control}
              name="code"
              label="Code"
              description={isEdit ? 'Fixed once the property exists: lease references use it.' : '2 to 8 letters or digits, used in lease references.'}
              placeholder="MSQ"
              maxLength={8}
              disabled={isEdit}
              required={!isEdit}
            />
            <SelectField control={form.control} name="type" label="Type" options={TYPE_OPTIONS} required />
            <SelectField control={form.control} name="status" label="Status" options={STATUS_OPTIONS} required />
            <NumberField control={form.control} name="grossLettableAreaSqm" label="Gross lettable area" suffix="m²" min={0} step={1} required />
            <TextAreaField control={form.control} name="description" label="Description" rows={3} maxLength={2000} className="sm:col-span-2" />
          </FormSection>
          <FormSection title="Address">
            <AddressAutocompleteField
              control={form.control}
              name="line1"
              label="Street address"
              maxLength={200}
              required
              className="sm:col-span-2"
              onAddressSelect={(address) => {
                const fill = { shouldDirty: true, shouldValidate: true } as const
                if (address.suburb) form.setValue('suburb', address.suburb, fill)
                if (address.city) form.setValue('city', address.city, fill)
                if (address.province) form.setValue('province', address.province, fill)
                if (address.postalCode) form.setValue('postalCode', address.postalCode, fill)
              }}
            />
            <TextField control={form.control} name="line2" label="Building or complex" autoComplete="address-line2" maxLength={200} className="sm:col-span-2" />
            <TextField control={form.control} name="suburb" label="Suburb" maxLength={100} required />
            <TextField control={form.control} name="city" label="City or town" autoComplete="address-level2" maxLength={100} required />
            <SelectField control={form.control} name="province" label="Province" options={PROVINCE_OPTIONS} required />
            <TextField control={form.control} name="postalCode" label="Postal code" autoComplete="postal-code" inputMode="numeric" maxLength={4} required />
          </FormSection>
          <FormSection title="Management and statements" description="The manager receives this property's monitoring events.">
            <SelectField
              control={form.control}
              name="managerUserId"
              label="Property manager"
              options={managerOptions}
              placeholder={members.isPending ? 'Loading members…' : 'Choose a manager'}
              required
            />
            <SelectField control={form.control} name="ownerUserId" label="Property owner" options={ownerOptions} description="Receives the weekly portfolio summary." />
            <SelectField
              control={form.control}
              name="accountingSystem"
              label="Accounting system"
              options={ACCOUNTING_OPTIONS}
              description="The system that produces this property's statements."
              required
            />
          </FormSection>
        </div>
      </Form>
    </FormDialog>
  )
}
