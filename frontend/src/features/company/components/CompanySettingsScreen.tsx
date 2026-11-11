import { useId } from 'react'

import { InformationGrid, InformationItem, StatusBadge } from '@/components/shared'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import type { CompanyProfile } from '../api/source'
import { CompanyProfileForm } from './CompanyProfileForm'
import { CompanySettingsView } from './CompanySettingsView'

function addressLines(address: CompanyProfile['address']): string[] {
  return [address.line1, address.line2, address.suburb, address.city, `${address.province} ${address.postalCode}`.trim(), address.country].filter(
    (line): line is string => typeof line === 'string' && line !== '',
  )
}

function CompanyDetails({ company }: { company: CompanyProfile }) {
  return (
    <InformationGrid>
      <InformationItem label="Registered name" value={company.name} />
      <InformationItem label="Trading name" value={company.tradingName} />
      <InformationItem label="Company registration number" value={company.registrationNumber} />
      <InformationItem label="VAT number" value={company.vatNumber} />
      <InformationItem
        label="Address"
        value={
          <address className="not-italic">
            {addressLines(company.address).map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
        }
      />
      <InformationItem
        label="Contact"
        value={
          <>
            <span className="block break-all">{company.contactEmail}</span>
            <span className="block">{company.contactPhone}</span>
          </>
        }
      />
    </InformationGrid>
  )
}

/**
 * Settings → Company: the active company's profile. Company admins edit it; other members read it.
 * Status, workspace initials, timezone and country are set by Nexus Solution and only shown.
 */
export function CompanySettingsScreen() {
  const detailsId = useId()
  const managedId = useId()
  return (
    <CompanySettingsView
      title="Company"
      description="Your company's registered details, address and contact information."
      readOnlyNotice="You can see the company details. Only company admins can change them."
    >
      {(company, isAdmin) => (
        <>
          <Card role="region" aria-labelledby={detailsId}>
            <CardHeader>
              <CardTitle id={detailsId} className="text-base">
                Company details
              </CardTitle>
              <CardDescription>
                {isAdmin ? 'Changes are recorded in the audit log.' : 'As recorded by your company admins.'}
              </CardDescription>
            </CardHeader>
            <CardContent>{isAdmin ? <CompanyProfileForm company={company} /> : <CompanyDetails company={company} />}</CardContent>
          </Card>
          <Card role="region" aria-labelledby={managedId}>
            <CardHeader>
              <CardTitle id={managedId} className="text-base">
                Managed by Nexus Solution
              </CardTitle>
              <CardDescription>These are set when the workspace is created. Contact Nexus Solution to change them.</CardDescription>
            </CardHeader>
            <CardContent>
              <InformationGrid columns={3}>
                <InformationItem label="Workspace status" value={<StatusBadge status={company.status} />} />
                <InformationItem label="Workspace initials" value={company.initials} />
                <InformationItem label="Timezone" value={company.settings.timezone} />
                <InformationItem label="Country" value={company.address.country} />
                <InformationItem label="Currency" value="South African rand (ZAR)" />
              </InformationGrid>
            </CardContent>
          </Card>
        </>
      )}
    </CompanySettingsView>
  )
}
