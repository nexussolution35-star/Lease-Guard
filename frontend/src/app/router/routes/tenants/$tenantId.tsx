import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound } from '@/components/layout'
import { RecordQueryView } from '@/components/shared'
import { useTenantQuery } from '@/features/tenants/api'
import { TenantDetailScreen } from '@/features/tenants/components/TenantDetailScreen'

export const Route = createFileRoute('/tenants/$tenantId')({
  component: function TenantDetailRoute() {
    const { tenantId } = useParams({ from: '/tenants/$tenantId' })
    const query = useTenantQuery(tenantId)
    return (
      <RecordQueryView
        query={query}
        notFound={<RecordNotFound entityLabel="Tenant" backTo="/tenants" backLabel="Back to tenants" />}
      >
        {(record) => <TenantDetailScreen tenant={record} />}
      </RecordQueryView>
    )
  },
})
