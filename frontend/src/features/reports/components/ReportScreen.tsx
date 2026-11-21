import type { ReportDefinition } from '@leaseguard/domain'

import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared'

import { isAvailableReportId } from '../api/source'
import type { ReportSearch } from '../reportSearch'
import { REPORT_VIEWS } from './reportViews'

export interface ReportScreenProps {
  definition: ReportDefinition
  search: ReportSearch
  onSearchChange: (next: ReportSearch) => void
}

/** One report in the shared frame; a report the reports service does not serve yet says so. */
export function ReportScreen({ definition, search, onSearchChange }: ReportScreenProps) {
  if (!isAvailableReportId(definition.id)) {
    return (
      <section>
        <PageHeader title={definition.title} description={definition.description} />
        <EmptyState title="This report is not available yet" description="It is listed so you know it is coming. Every other report on the Reports page is ready." />
      </section>
    )
  }
  const View = REPORT_VIEWS[definition.id]
  return <View definition={definition} search={search} onSearchChange={onSearchChange} />
}
