import { ShieldCheck } from 'lucide-react'
import { useId } from 'react'

import { InformationGrid, InformationItem } from '@/components/shared'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { labelFor } from '@/lib/labels'

import type { CompanyProfile } from '../api/source'
import { formatNoticeDays } from '../monitoringSettingsSchema'
import { CompanySettingsView } from './CompanySettingsView'
import { MonitoringSettingsForm } from './MonitoringSettingsForm'

const days = (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`
const noticeList = (list: readonly number[]) => `${formatNoticeDays(list)} days before`

function MonitoringSettingsDetails({ settings }: { settings: CompanyProfile['settings'] }) {
  const offsets = settings.paymentReminderOffsetsDays
  return (
    <InformationGrid>
      <InformationItem label="Lease expiry notices" value={noticeList(settings.leaseExpiryNoticeDays)} />
      <InformationItem label="Renewal notice deadline warnings" value={noticeList(settings.renewalDeadlineWarningDays)} />
      <InformationItem label="Bank guarantee expiry notices" value={noticeList(settings.guaranteeExpiryNoticeDays)} />
      <InformationItem label="Initial payment reminder" value={`${days(offsets.initial)} after the statement date`} />
      <InformationItem label="Overdue payment reminder" value={`${days(offsets.overdue)} after the statement date`} />
      <InformationItem label="Follow-up payment reminder" value={`${days(offsets.followUp)} after the statement date`} />
      <InformationItem label="Instalment reminder" value={`${days(settings.installmentReminderLeadDays)} before the instalment is due`} />
      <InformationItem label="Owner summary" value={`Every ${labelFor(settings.ownerSummaryWeekday)}`} />
    </InformationGrid>
  )
}

/**
 * Settings → Notifications: when the workspace's monitoring events are raised and its reminders are
 * prepared. Company admins change the timing; other members read it. Whether tenant messages need
 * approval is not a setting: they always do.
 */
export function MonitoringSettingsScreen() {
  const timingId = useId()
  return (
    <CompanySettingsView
      title="Notifications"
      description="Notice periods for monitoring events and the timing of payment reminders and owner summaries."
      readOnlyNotice="You can see the notice periods and reminder timing. Only company admins can change them."
    >
      {(company, isAdmin) => (
        <>
          <Card role="region" aria-labelledby={timingId}>
            <CardHeader>
              <CardTitle id={timingId} className="text-base">
                Notice periods and reminder timing
              </CardTitle>
              <CardDescription>All times are South African time ({company.settings.timezone}).</CardDescription>
            </CardHeader>
            <CardContent>{isAdmin ? <MonitoringSettingsForm settings={company.settings} /> : <MonitoringSettingsDetails settings={company.settings} />}</CardContent>
          </Card>
          <p className="flex gap-2 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Every tenant message needs a property manager's approval before it is sent. This cannot be switched off, and tenants only ever receive
            statements and payment reminders.
          </p>
        </>
      )}
    </CompanySettingsView>
  )
}
