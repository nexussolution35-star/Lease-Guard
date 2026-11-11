import { SA_PROVINCES } from '@leaseguard/domain'
import { AlertCircle } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { FormActions, FormSection, SelectField, TextField, zodResolver } from '@/components/forms'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'
import { describeApiError } from '@/lib/data/apiErrors'

import { useUpdateCompany } from '../api/queries'
import type { CompanyProfile } from '../api/source'
import {
  companyProfileChangesFrom,
  companyProfileFormDefaults,
  companyProfileFormSchema,
  type CompanyProfileFormInput,
  type CompanyProfileFormValues,
} from '../companyProfileSchema'

export interface CompanyProfileFormProps {
  company: CompanyProfile
}

const PROVINCE_OPTIONS = SA_PROVINCES.map((province) => ({ value: province, label: province }))
const FALLBACK_ERROR = 'The company details could not be saved. Try again.'

/** The company profile a company admin edits: names, registration, address and contact details. */
export function CompanyProfileForm({ company }: CompanyProfileFormProps) {
  const update = useUpdateCompany()
  const form = useForm<CompanyProfileFormInput, unknown, CompanyProfileFormValues>({
    resolver: zodResolver(companyProfileFormSchema),
    defaultValues: companyProfileFormDefaults(company),
  })
  const { reset } = form

  // Follow the saved company: after a save, and when the workspace changes.
  useEffect(() => {
    reset(companyProfileFormDefaults(company))
  }, [company, reset])

  const rootError = form.formState.errors.root?.message

  const submit = form.handleSubmit(async (values) => {
    const changes = companyProfileChangesFrom(values, company)
    if (changes === null) {
      toast.info('Nothing to save: the company details are unchanged.')
      return
    }
    try {
      await update.mutateAsync(changes)
      toast.success('Company details saved')
    } catch (error) {
      form.setError('root', { type: 'server', message: describeApiError(error, FALLBACK_ERROR) })
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={(event) => void submit(event)} noValidate className="space-y-8" aria-label="Company details">
        {rootError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{rootError}</AlertDescription>
          </Alert>
        ) : null}
        <FormSection title="Company" description="The registered name appears in the workspace switcher and on owner summaries.">
          <TextField control={form.control} name="name" label="Registered name" autoComplete="organization" maxLength={200} required />
          <TextField control={form.control} name="tradingName" label="Trading name" maxLength={200} />
          <TextField control={form.control} name="registrationNumber" label="Company registration number" placeholder="2019/123456/07" maxLength={50} />
          <TextField control={form.control} name="vatNumber" label="VAT number" inputMode="numeric" maxLength={30} />
        </FormSection>
        <FormSection title="Address">
          <TextField control={form.control} name="line1" label="Street address" autoComplete="address-line1" maxLength={200} required className="sm:col-span-2" />
          <TextField control={form.control} name="line2" label="Building, floor or suite" autoComplete="address-line2" maxLength={200} className="sm:col-span-2" />
          <TextField control={form.control} name="suburb" label="Suburb" maxLength={100} required />
          <TextField control={form.control} name="city" label="City or town" autoComplete="address-level2" maxLength={100} required />
          <SelectField control={form.control} name="province" label="Province" options={PROVINCE_OPTIONS} required />
          <TextField control={form.control} name="postalCode" label="Postal code" autoComplete="postal-code" inputMode="numeric" maxLength={4} required />
        </FormSection>
        <FormSection title="Contact" description="Where Nexus Solution and LeaseGuard notices reach the company.">
          <TextField control={form.control} name="contactEmail" label="Contact email" type="email" autoComplete="email" maxLength={320} required />
          <TextField control={form.control} name="contactPhone" label="Contact phone" autoComplete="tel" inputMode="tel" maxLength={30} required />
        </FormSection>
        <FormActions submitLabel="Save changes" isSubmitting={form.formState.isSubmitting} />
      </form>
    </Form>
  )
}
