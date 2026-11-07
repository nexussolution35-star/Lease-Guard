import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound, ScreenPlaceholder } from '@/components/layout'
import { useTenant } from '@/services/tenants'

export const Route = createFileRoute('/tenants/$tenantId')({
  component: function TenantDetailScreen() {
    const { tenantId } = useParams({ from: '/tenants/$tenantId' })
    const record = useTenant(tenantId)
    if (!record) return <RecordNotFound entityLabel="Tenant" backTo="/tenants" backLabel="Back to tenants" />
    return <ScreenPlaceholder title={record.tradingName} description="Tenant profile, leases, statements and communication history." />
  },
})
