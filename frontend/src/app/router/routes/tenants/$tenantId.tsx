import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound, ScreenPlaceholder } from '@/components/layout'
import { RecordQueryView } from '@/components/shared'
import { useTenantQuery } from '@/features/tenants/api'

export const Route = createFileRoute('/tenants/$tenantId')({
  component: function TenantDetailScreen() {
    const { tenantId } = useParams({ from: '/tenants/$tenantId' })
    const query = useTenantQuery(tenantId)
    return (
      <RecordQueryView
        query={query}
        notFound={<RecordNotFound entityLabel="Tenant" backTo="/tenants" backLabel="Back to tenants" />}
      >
        {(record) => <ScreenPlaceholder title={record.tradingName} description="Tenant profile, leases, statements and communication history." />}
      </RecordQueryView>
    )
  },
})
