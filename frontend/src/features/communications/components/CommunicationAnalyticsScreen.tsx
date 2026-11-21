import {
  addDaysISO,
  communicationAnalyticsRangeProblem,
  formatCount,
  formatSADate,
  isoToday,
  shareOf,
  type CommunicationAnalytics,
  type CommunicationAnalyticsRange,
  type ISODate,
} from '@leaseguard/domain'
import { AlertCircle } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { DateField, zodResolver } from '@/components/forms'
import { PageHeader } from '@/components/layout/PageHeader'
import { ErrorState, MetricCard, MetricGrid, NoActiveWorkspace } from '@/components/shared'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { describeApiError } from '@/lib/data/apiErrors'
import { isAwaitingWorkspace } from '@/lib/data/queries'

import { useCommunicationAnalytics } from '../api/queries'

export interface CommunicationAnalyticsScreenProps {
  /** First South African day included (from the address); without it the API's default range. */
  from?: ISODate
  /** Last South African day included (from the address). */
  to?: ISODate
  onRangeChange: (range: CommunicationAnalyticsRange) => void
}

const QUICK_RANGES = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
] as const

const rangeFormSchema = z
  .object({ from: z.string().optional(), to: z.string().optional() })
  .superRefine((values, ctx) => {
    if (!values.from) ctx.addIssue({ code: 'custom', path: ['from'], message: 'Choose a start date.' })
    if (!values.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Choose an end date.' })
    if (!values.from || !values.to) return
    const problem = communicationAnalyticsRangeProblem({ from: values.from, to: values.to })
    if (problem) ctx.addIssue({ code: 'custom', path: ['to'], message: problem })
  })
type RangeFormValues = z.input<typeof rangeFormSchema>

/**
 * The active workspace's WhatsApp figures over a date range: messages received and sent (with Meta's delivered, read
 * and failed reports), handovers, and what the AI agent did. Every member can see them; the API computes them from
 * this workspace's records only.
 */
export function CommunicationAnalyticsScreen({ from, to, onRangeChange }: CommunicationAnalyticsScreenProps) {
  const requested = useMemo(() => ({ ...(from ? { from } : {}), ...(to ? { to } : {}) }), [from, to])
  // A range in the address that the API would refuse is explained here instead of asked for.
  const problem = from && to ? communicationAnalyticsRangeProblem({ from, to }) : undefined
  const query = useCommunicationAnalytics(requested, { enabled: problem === undefined })
  const shown = query.data
  const header = (
    <PageHeader
      title="Communication analytics"
      description="WhatsApp messages, handovers and AI agent activity in this workspace. Only this workspace’s own records count."
    />
  )

  if (!problem && isAwaitingWorkspace(query)) {
    return (
      <section>
        {header}
        <NoActiveWorkspace />
      </section>
    )
  }

  const isLoading = !problem && query.isPending
  const quiet = shown !== undefined && isQuiet(shown)

  return (
    <section className="space-y-10">
      {header}
      <RangePicker key={`${shown?.from ?? from ?? ''}:${shown?.to ?? to ?? ''}`} current={problem ? { from, to } : (shown ?? { from, to })} onRangeChange={onRangeChange} />

      {problem ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>This range cannot be shown</AlertTitle>
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      ) : null}

      {!problem && query.isError ? (
        <ErrorState
          title="The communication analytics could not be loaded"
          error={describeApiError(query.error, 'Try again in a moment.')}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {!problem && !query.isError ? (
        <>
          <div aria-live="polite" className="space-y-1">
            {shown ? (
              <p className="text-sm text-muted-foreground">
                Figures for <span className="font-medium text-foreground">{`${formatSADate(shown.from)} to ${formatSADate(shown.to)}`}</span>
              </p>
            ) : null}
            {quiet ? <p className="text-sm text-foreground">No WhatsApp activity in this period.</p> : null}
          </div>
          {/* Every strip sits on the same five-column rhythm, so cells line up from one section to the next; each has one lead figure. */}
          <FigureSection
            title="Messages"
            description="WhatsApp messages on the day they were recorded, by their latest status. Sent counts every message handed to WhatsApp; drafts, messages awaiting approval and rejected messages are not sent. Test messages never count."
            gridClassName="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
          >
            <Figure label="Received" value={shown?.inbound} isLoading={isLoading} />
            <Figure label="Sent" value={shown?.outbound} isLoading={isLoading} />
            <Figure lead label="Delivered" value={shown?.delivered} share={shown && shareOf(shown.delivered, shown.outbound)} isLoading={isLoading} />
            <Figure label="Read" value={shown?.read} share={shown && shareOf(shown.read, shown.outbound)} isLoading={isLoading} />
            <Figure label="Failed" danger value={shown?.failed} share={shown && shareOf(shown.failed, shown.outbound)} isLoading={isLoading} />
          </FigureSection>
          <FigureSection
            title="Handovers"
            description="Conversations handed to a person, by the AI agent or by a member taking over."
            gridClassName="grid-cols-1 sm:w-1/3 lg:w-1/5"
          >
            <Figure
              lead
              label="Handovers opened"
              value={shown?.handovers}
              description={shown ? `${shown.agentHandovers} by the AI agent` : undefined}
              isLoading={isLoading}
            />
          </FigureSection>
          <FigureSection
            title="AI agent"
            description="What the AI agent did with incoming messages. It answers contacts only; tenants are never answered automatically, and suggested replies are for staff only and never sent."
            gridClassName="sm:grid-cols-3 lg:w-3/5"
          >
            <Figure lead label="Answers sent" value={shown?.agentReplies} isLoading={isLoading} />
            <Figure label="Out-of-hours messages" value={shown?.outOfHoursMessages} isLoading={isLoading} />
            <Figure label="Suggested replies" value={shown?.suggestedReplies} isLoading={isLoading} />
          </FigureSection>
        </>
      ) : null}
    </section>
  )
}

function isQuiet(figures: CommunicationAnalytics): boolean {
  return (
    figures.inbound + figures.outbound + figures.handovers + figures.agentReplies + figures.outOfHoursMessages + figures.suggestedReplies === 0
  )
}

function FigureSection({ title, description, gridClassName, children }: { title: string; description: string; gridClassName: string; children: ReactNode }) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="space-y-3">
      <div className="space-y-1">
        <h2 id={titleId} className="text-base font-medium text-balance text-foreground">
          {title}
        </h2>
        <p className="max-w-3xl text-sm text-pretty text-muted-foreground">{description}</p>
      </div>
      <MetricGrid columns={2} className={gridClassName}>
        {children}
      </MetricGrid>
    </section>
  )
}

interface FigureProps {
  label: string
  value: number | undefined
  /** Coloured when it is not zero: only failures are. */
  danger?: boolean
  /** Percentage of the messages sent. */
  share?: number | undefined
  description?: string | undefined
  isLoading: boolean
  /** The strip's figure that matters, set larger. One per strip. */
  lead?: boolean
}

function Figure({ label, value, danger = false, share, description, isLoading, lead = false }: FigureProps) {
  const text = description ?? (share !== undefined ? `${share}% of sent` : undefined)
  return (
    <MetricCard
      label={label}
      tone={danger ? 'danger' : 'neutral'}
      value={value === undefined ? '–' : formatCount(value)}
      isLoading={isLoading}
      lead={lead}
      {...(text ? { description: text } : {})}
    />
  )
}

function RangePicker({ current, onRangeChange }: { current: { from?: ISODate | undefined; to?: ISODate | undefined }; onRangeChange: (range: CommunicationAnalyticsRange) => void }) {
  // Read once per mount: the quick ranges and the latest pickable day.
  const [today] = useState(() => isoToday(new Date()))
  const form = useForm<RangeFormValues, unknown, RangeFormValues>({
    resolver: zodResolver(rangeFormSchema),
    defaultValues: { from: current.from, to: current.to },
  })
  const submit = form.handleSubmit((values) => {
    if (values.from && values.to) onRangeChange({ from: values.from, to: values.to })
  })
  const isCurrent = (days: number) => current.to === today && current.from === addDaysISO(today, -(days - 1))

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick ranges">
          {QUICK_RANGES.map((range) => (
            <Button
              key={range.days}
              type="button"
              variant="outline"
              size="sm"
              className="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
              aria-pressed={isCurrent(range.days)}
              onClick={() => onRangeChange({ from: addDaysISO(today, -(range.days - 1)), to: today })}
            >
              {range.label}
            </Button>
          ))}
        </div>
        <Form {...form}>
          <form onSubmit={(event) => void submit(event)} noValidate aria-label="Custom date range" className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
            <DateField control={form.control} name="from" label="Start date" required clearable={false} max={today} className="min-w-0 flex-1 sm:w-40 sm:flex-none" />
            <DateField control={form.control} name="to" label="End date" required clearable={false} max={today} className="min-w-0 flex-1 sm:w-40 sm:flex-none" />
            <Button type="submit" variant="outline" className="ml-auto">
              Show figures
            </Button>
          </form>
        </Form>
      </div>
      <p className="text-xs text-muted-foreground">South African calendar days; both dates are included. At most 366 days.</p>
    </div>
  )
}
