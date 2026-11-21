import { messageTypeTemplateState, previewTemplateBody, type MessageTypeTemplate } from '@leaseguard/domain'

import { SignOff, StatusDot } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { labelFor, MESSAGE_TEMPLATE_STATE_LABELS, MESSAGE_TEMPLATE_STATE_TONES } from '@/lib/labels'
import { cn } from '@/lib/utils'

export interface MessageTypeTemplateRowProps {
  type: MessageTypeTemplate
  /** Shown to company admins: opens the choice of template. */
  onChoose?: () => void
  className?: string
}

const sentence = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ')

/**
 * One message type with the template that sends it: whether it can be sent (status dot and text, and when it cannot,
 * why and what to do next), the template's name, language and Meta status, whether it carries the statement PDF, who
 * chose it, and a preview of its text with sample values.
 */
export function MessageTypeTemplateRow({ type, onChoose, className }: MessageTypeTemplateRowProps) {
  const { mapping } = type
  const state = messageTypeTemplateState(mapping)
  const label = labelFor(type.messageType)
  return (
    <li className={cn('space-y-3 py-4', className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-medium text-foreground">{label}</h3>
          <StatusDot tone={MESSAGE_TEMPLATE_STATE_TONES[state.status]}>{MESSAGE_TEMPLATE_STATE_LABELS[state.status]}</StatusDot>
        </div>
        {onChoose ? (
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={onChoose} aria-label={`${mapping ? 'Change' : 'Choose'} the template for ${label.toLowerCase()}`}>
              {mapping ? 'Change template' : 'Choose template'}
            </Button>
          </div>
        ) : null}
      </div>

      {state.sendable ? null : (
        <div className="space-y-0.5 text-sm">
          <p className="text-foreground">{state.summary}</p>
          {state.nextStep ? <p className="text-xs text-muted-foreground italic">{state.nextStep}</p> : null}
        </div>
      )}

      {mapping ? (
        <>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Template</dt>
              <dd className="truncate font-mono text-xs text-foreground">{mapping.metaTemplateName}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Language</dt>
              <dd className="font-mono text-xs text-foreground">{mapping.language}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Meta status</dt>
              <dd className="text-foreground">
                {mapping.metaStatus ? sentence(mapping.metaStatus) : 'No longer held by Meta'}
                {mapping.rejectedReason ? <span className="block text-xs text-muted-foreground">{sentence(mapping.rejectedReason)}</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Statement PDF</dt>
              <dd className="text-foreground">{mapping.supportsDocumentAttachment ? 'Attached as a document' : 'Not attached'}</dd>
            </div>
          </dl>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Chosen by</span>
            <SignOff by={mapping.mappedByName} at={mapping.mappedAt} pendingLabel="A former member" />
          </div>
          <details className="group text-sm">
            <summary className="w-fit cursor-pointer rounded-sm text-primary underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
              Preview with sample values
            </summary>
            <div className="mt-2 space-y-1">
              <blockquote className="border-l-2 border-border pl-3 whitespace-pre-line text-foreground">
                {previewTemplateBody(type.messageType, mapping.body)}
              </blockquote>
              {mapping.variables.length > 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  Sample values, not real records. Variables: {mapping.variables.map((name, i) => `{{${i + 1}}} ${name}`).join(', ')}.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground italic">This template has no variables.</p>
              )}
            </div>
          </details>
        </>
      ) : null}
    </li>
  )
}
