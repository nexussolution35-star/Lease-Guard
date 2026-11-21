import {
  canMapTemplate,
  previewTemplateBody,
  templateInUseBy,
  templateMappingProblems,
  type MappingCandidate,
  type MessageTypeTemplate,
  type WhatsAppMessageTemplate,
  type WhatsAppTemplateHeaderFormat,
} from '@leaseguard/domain'
import { AlertCircle } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { ErrorState, FormDialog, LoadingState, StatusDot } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useWhatsAppMessageTemplates } from '@/features/whatsapp-integration/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { labelFor, type Tone } from '@/lib/labels'

import { useChooseMessageTemplate } from '../api/queries'

export interface ChooseTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The message type to choose a template for. */
  type: MessageTypeTemplate
  /** Every type, to name the one a template already sends. */
  types: readonly MessageTypeTemplate[]
}

const META_STATUS_TONES: Readonly<Record<string, Tone>> = {
  APPROVED: 'success',
  FLAGGED: 'warning',
  PENDING: 'info',
  IN_APPEAL: 'info',
  PAUSED: 'warning',
  REJECTED: 'danger',
  DISABLED: 'danger',
}

const sentence = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ')

function candidateOf(template: WhatsAppMessageTemplate): MappingCandidate {
  return {
    name: template.name,
    language: template.language,
    category: template.category,
    status: template.status,
    ...(template.body ? { body: template.body } : {}),
    ...(template.headerFormat ? { headerFormat: template.headerFormat as WhatsAppTemplateHeaderFormat } : {}),
  }
}

/**
 * A company admin picks which synced Meta template sends a message type. Templates that cannot serve it stay listed,
 * disabled, with every reason (Meta has not approved it, a tenant type needs a Utility template, forbidden tenant
 * topics, banking details, missing text, or it already sends another type); the API and the database check the same.
 * The chosen template's text is previewed with sample values. A stray click outside never closes the dialog.
 */
export function ChooseTemplateDialog({ open, onOpenChange, type, types }: ChooseTemplateDialogProps) {
  const templates = useWhatsAppMessageTemplates()
  const choose = useChooseMessageTemplate()
  // Mounted while open (the screen renders it per choice), so the current template is the starting choice.
  const current = type.mapping?.whatsappTemplateId ?? ''
  const [selected, setSelected] = useState<string>(current)
  const [error, setError] = useState<string | null>(null)
  const label = labelFor(type.messageType)
  const groupLabel = useId()

  const options = useMemo(
    () =>
      (templates.data ?? [])
        .map((template) => {
          const candidate = candidateOf(template)
          const inUseBy = templateInUseBy(types, candidate, type.messageType)
          const problems = [
            ...templateMappingProblems(type.messageType, candidate),
            ...(inUseBy ? [`Already sends ${labelFor(inUseBy)} messages. A template sends one message type.`] : []),
          ]
          return { template, candidate, problems, available: canMapTemplate(type.messageType, candidate) && !inUseBy }
        })
        // Templates that can serve the type first, then by name.
        .sort((a, b) => Number(b.available) - Number(a.available) || a.template.name.localeCompare(b.template.name)),
    [templates.data, types, type.messageType],
  )

  const chosen = options.find((o) => o.template.id === selected)
  const preview = chosen?.available && chosen.template.body ? previewTemplateBody(type.messageType, chosen.template.body) : null

  async function submit() {
    if (!chosen?.available) {
      setError('Choose an approved template that can send this message.')
      return
    }
    setError(null)
    try {
      await choose.mutateAsync({ messageType: type.messageType, whatsappTemplateId: chosen.template.id })
      toast.success(`${label} now sent with ${chosen.template.name}`, { description: 'The change is recorded in the audit log.' })
      onOpenChange(false)
    } catch (failure) {
      setError(describeApiError(failure, 'The template could not be chosen. Try again.'))
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Template for ${label.toLowerCase()}`}
      description={
        type.audience === 'tenant'
          ? 'Tenants only receive statement and payment messages, each approved by a property manager before it is sent. Only approved Utility templates can be chosen.'
          : 'Sent to property owners. Only templates Meta has approved can be chosen.'
      }
      submitLabel="Use this template"
      onSubmit={submit}
      isPending={choose.isPending}
      submitDisabled={!chosen?.available || selected === current}
      size="lg"
    >
      {error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {templates.isPending ? <LoadingState label="Loading WhatsApp templates…" rows={3} /> : null}
      {templates.isError ? (
        <ErrorState title="WhatsApp templates could not be loaded" error={templates.error} onRetry={() => void templates.refetch()} />
      ) : null}
      {templates.data && options.length === 0 ? (
        <p className="text-sm text-muted-foreground">No templates synced from Meta yet. Sync the templates, then choose one.</p>
      ) : null}
      {options.length > 0 ? (
        <fieldset className="space-y-2">
          <legend id={groupLabel} className="mb-2 text-sm font-medium text-foreground">
            WhatsApp template
          </legend>
          <RadioGroup aria-labelledby={groupLabel} value={selected} onValueChange={setSelected} className="gap-0 divide-y divide-border border-y border-border">
            {options.map(({ template, problems, available }) => {
              const id = `template-${template.id}`
              const reasons = `${id}-reasons`
              return (
                <div key={template.id} className="flex items-start gap-3 py-3">
                  <RadioGroupItem
                    id={id}
                    value={template.id}
                    disabled={!available}
                    className="mt-0.5"
                    {...(problems.length > 0 ? { 'aria-describedby': reasons } : {})}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <label htmlFor={id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                      <span className="font-mono text-xs text-foreground">{template.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{template.language}</span>
                      <span className="text-muted-foreground">{sentence(template.category)}</span>
                      <StatusDot tone={META_STATUS_TONES[template.status] ?? 'neutral'}>{sentence(template.status)}</StatusDot>
                    </label>
                    {template.headerFormat === 'DOCUMENT' ? <p className="text-xs text-muted-foreground">Carries the statement PDF</p> : null}
                    {problems.length > 0 ? (
                      <ul id={reasons} className="space-y-0.5 text-xs text-muted-foreground italic">
                        {problems.map((problem) => (
                          <li key={problem}>{problem}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </RadioGroup>
        </fieldset>
      ) : null}
      {preview ? (
        <section aria-label="Preview" className="space-y-1">
          <h3 className="text-sm font-medium text-foreground">Preview</h3>
          <p className="text-xs text-muted-foreground italic">With sample values, not real records.</p>
          <blockquote className="border-l-2 border-border pl-3 text-sm whitespace-pre-line text-foreground">{preview}</blockquote>
        </section>
      ) : null}
    </FormDialog>
  )
}
