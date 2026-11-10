import { createFileRoute, stripSearchParams } from '@tanstack/react-router'

import { PropertyListScreen } from '@/features/properties/components/PropertyListScreen'
import { PROPERTY_LIST_DEFAULTS, propertyListSearchSchema } from '@/features/properties/listSearch'

export const Route = createFileRoute('/properties/')({
  validateSearch: propertyListSearchSchema,
  search: { middlewares: [stripSearchParams(PROPERTY_LIST_DEFAULTS)] },
  component: function PropertiesScreen() {
    const params = Route.useSearch()
    const navigate = Route.useNavigate()
    return <PropertyListScreen params={params} onParamsChange={(next) => void navigate({ search: next, replace: true })} />
  },
})
