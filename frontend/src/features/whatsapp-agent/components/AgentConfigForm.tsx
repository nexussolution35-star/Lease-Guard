import { useId } from 'react'
import { Controller, type FieldErrors, type FieldValues, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { AlertCircle, AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { autoReplyWarnings, AGENT_LANGUAGES, AGENT_PERMITTED_ACTIONS, WEEKDAYS, type WhatsAppAgentConfig } from '@leaseguard/domain'
import { toast } from 'sonner'

import { FormSection, FormValidationSummary, MultiSelectField, TextAreaField, TextField, zodResolver } from '@/components/forms'
import { DateDisplay } from '@/components/shared'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Form } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { assignableMembers } from '@/features/whatsapp-conversations/handover'
import type { CompanyMember } from '@/features/users/api/source'
import { describeApiError } from '@/lib/data/apiErrors'

import { useSaveAgentConfig } from '../api/queries'
import {
  ACTION_TEXT,
  agentConfigInput,
  agentFormDefaults,
  agentFormSchema,
  DAY_LABELS,
  LANGUAGE_LABELS,
  type AgentFormInput,
  type AgentFormValues,
} from '../agentFormSchema'

export interface AgentConfigFormProps {
  config: WhatsAppAgentConfig
  members: readonly CompanyMember[]
  /** Company admins edit; everyone else sees the settings read-only. */
  canEdit: boolean
}

const FIELD_LABELS: Record<string, string> = {
  agentName: 'Agent name',
  operatingHours: 'Operating hours',
  languages: 'Languages',
  handoverContactUserIds: 'Handover contacts',
}

/**
 * The AI agent's settings (company admins save them; `PUT /whatsapp/agent`). The form starts from `config` when it
 * mounts; render it with a key that changes when a newer configuration is saved, so a failed save keeps its error.
 */
export function AgentConfigForm({ config, members, canEdit }: AgentConfigFormProps) {
  const save = useSaveAgentConfig()
  const autoReplyId = useId()
  const form = useForm<AgentFormInput, unknown, AgentFormValues>({ resolver: zodResolver(agentFormSchema), defaultValues: agentFormDefaults(config) })
  const hours = useFieldArray({ control: form.control, name: 'operatingHours' })
  const [autoReplyEnabled, permittedActions, operatingHours] = useWatch({ control: form.control, name: ['autoReplyEnabled', 'permittedActions', 'operatingHours'] })
  const warnings = autoReplyWarnings({ autoReplyEnabled, permittedActions, operatingHours })

  const contactOptions = assignableMembers(members, config.companyId).map((member) => ({ value: member.id, label: member.fullName }))
  // A saved contact who is no longer an active admin or manager still shows, so the admin can remove them.
  for (const contact of config.handoverContacts) {
    if (!contactOptions.some((option) => option.value === contact.userId)) {
      contactOptions.push({ value: contact.userId, label: `${contact.name ?? 'Former member'} (cannot handle conversations)` })
    }
  }

  const submit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync(agentConfigInput(values))
      toast.success('AI agent settings saved')
    } catch (error) {
      form.setError('root', { type: 'server', message: describeApiError(error, 'The AI agent settings could not be saved. Try again.') })
    }
  })

  // The server's refusal shows once, in its own alert; the summary lists the fields to correct.
  const { root, ...fieldErrors } = form.formState.errors
  const rootError = root?.message
  const hoursError = form.formState.errors.operatingHours?.root?.message ?? form.formState.errors.operatingHours?.message

  return (
    <Form {...form}>
      <form onSubmit={(event) => void submit(event)} noValidate aria-label="AI agent settings" className="space-y-6">
        <fieldset disabled={!canEdit || form.formState.isSubmitting} className="space-y-6">
          <FormValidationSummary errors={fieldErrors as FieldErrors<FieldValues>} fieldLabels={FIELD_LABELS} />
          {rootError ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertDescription>{rootError}</AlertDescription>
            </Alert>
          ) : null}

          <FormSection columns={1} title="Identity" description="How the agent introduces itself and what it knows about your business.">
            <div className="grid gap-4 md:grid-cols-2">
              <TextField control={form.control} name="agentName" label="Agent name" required maxLength={80} placeholder="e.g. Atlas assistant" />
              <TextField control={form.control} name="tone" label="Tone and personality" maxLength={500} placeholder="e.g. Warm, brief and professional" />
            </div>
            <TextAreaField control={form.control} name="businessDescription" label="Business description" rows={4} maxLength={4000} showCount />
            <MultiSelectField
              control={form.control}
              name="languages"
              label="Languages"
              required
              description="The agent replies in the contact's language when it is one of these."
              options={AGENT_LANGUAGES.map((code) => ({ value: code, label: LANGUAGE_LABELS[code] }))}
              placeholder="Choose languages"
            />
          </FormSection>

          <FormSection
            columns={1}
            title="Operating hours"
            description={`South African time (${config.timezone}). Outside these hours contacts get the out-of-hours message, once per conversation window.`}
          >
            {hours.fields.length === 0 ? <p className="text-sm text-muted-foreground">No operating hours: the agent is always outside hours.</p> : null}
            <ul className="space-y-2" aria-label="Opening periods">
              {hours.fields.map((field, index) => (
                <li key={field.id} className="flex flex-wrap items-end gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor={`hours-day-${index}`}>Day</Label>
                    <select
                      id={`hours-day-${index}`}
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      {...form.register(`operatingHours.${index}.day`)}
                    >
                      {WEEKDAYS.map((day) => (
                        <option key={day} value={day}>
                          {DAY_LABELS[day]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`hours-opens-${index}`}>Opens</Label>
                    <Input id={`hours-opens-${index}`} type="time" step={60} className="w-32" {...form.register(`operatingHours.${index}.opens`)} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`hours-closes-${index}`}>Closes</Label>
                    <Input id={`hours-closes-${index}`} type="time" step={60} className="w-32" {...form.register(`operatingHours.${index}.closes`)} />
                  </div>
                  {canEdit ? (
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove opening period ${index + 1}`} onClick={() => hours.remove(index)}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            {hoursError ? (
              <p role="alert" className="text-sm text-destructive">
                {hoursError}
              </p>
            ) : null}
            {canEdit ? (
              <Button type="button" variant="outline" size="sm" onClick={() => hours.append({ day: 'monday', opens: '08:00', closes: '17:00' })}>
                <Plus className="size-4" aria-hidden="true" />
                Add opening period
              </Button>
            ) : null}
            <TextAreaField
              control={form.control}
              name="outOfHoursMessage"
              label="Out-of-hours message"
              description="Sent to a contact who writes outside operating hours, at most once per 24-hour window. Leave empty to send nothing."
              rows={2}
              maxLength={1000}
            />
          </FormSection>

          <FormSection columns={1} title="Instructions" description="What the agent must and must not say, and when it hands over to a person.">
            <TextAreaField control={form.control} name="policies" label="Policies" rows={3} maxLength={8000} />
            <TextAreaField control={form.control} name="supportInstructions" label="Support instructions" rows={3} maxLength={8000} />
            <TextAreaField
              control={form.control}
              name="escalationRules"
              label="When to hand over to a person"
              description="Complaints, payments, payment arrangements, disputes, lease expiry and renewals always go to a person, whatever you write here."
              rows={3}
              maxLength={8000}
            />
            <MultiSelectField
              control={form.control}
              name="handoverContactUserIds"
              label="Handover contacts"
              description="Company admins and property managers told when the agent hands a conversation to a person."
              options={contactOptions}
              placeholder="Choose people"
            />
          </FormSection>

          <FormSection columns={1} title="What the agent may do" description="Only the actions you tick. The agent uses approved knowledge of this company only.">
            <Controller
              control={form.control}
              name="permittedActions"
              render={({ field }) => (
                <ul className="space-y-3">
                  {AGENT_PERMITTED_ACTIONS.map((action) => {
                    const id = `action-${action}`
                    const checked = field.value.includes(action)
                    return (
                      <li key={action} className="flex items-start gap-3">
                        <Checkbox
                          id={id}
                          checked={checked}
                          disabled={!canEdit}
                          onCheckedChange={(next) =>
                            field.onChange(next === true ? [...field.value, action] : field.value.filter((value) => value !== action))
                          }
                          aria-describedby={`${id}-description`}
                          className="mt-0.5"
                        />
                        <div className="grid gap-0.5">
                          <Label htmlFor={id} className="font-normal">
                            {ACTION_TEXT[action].label}
                          </Label>
                          <p id={`${id}-description`} className="text-sm text-muted-foreground">
                            {ACTION_TEXT[action].description}
                          </p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            />
            <Controller
              control={form.control}
              name="autoReplyEnabled"
              render={({ field }) => (
                <div className="flex items-start gap-3 rounded-md border border-border p-4">
                  <Switch id={autoReplyId} checked={field.value} onCheckedChange={field.onChange} disabled={!canEdit} aria-describedby={`${autoReplyId}-description`} />
                  <div className="grid gap-1">
                    <Label htmlFor={autoReplyId}>Reply to contacts automatically</Label>
                    <p id={`${autoReplyId}-description`} className="text-sm text-muted-foreground">
                      Only contacts (people who are not your tenants), only inside WhatsApp’s 24-hour window and only with your approved
                      information. Tenants are never answered automatically: when a tenant writes, staff get a suggested reply and the
                      conversation is handed to a person.
                    </p>
                  </div>
                </div>
              )}
            />
            {warnings.length > 0 ? (
              <Alert className="border-warning/40 bg-warning/10">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>Check these settings</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5">
                    {warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
          </FormSection>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {config.configured && config.updatedAt ? (
              <>
                Last saved <DateDisplay value={config.updatedAt} style="datetime" />.
              </>
            ) : (
              'Not set up yet: the agent does not answer anyone until it is configured and auto-reply is on.'
            )}
          </p>
          {canEdit ? (
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Saving…' : 'Save AI agent settings'}
            </Button>
          ) : null}
        </div>
      </form>
    </Form>
  )
}
