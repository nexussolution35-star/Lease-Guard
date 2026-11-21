import { InformationGrid, InformationItem, StatusBadge } from '@/components/shared'

import type { CompanyProfile } from '../api/source'
import { CompanyProfileForm } from './CompanyProfileForm'
import { CompanySettingsView } from './CompanySettingsView'
import { SettingsRow } from './SettingsRow'

function addressLines(address: CompanyProfile['address']): string[] {
  return [address.line1, address.line2, address.suburb, address.city, `${address.province} ${address.postalCode}`.trim(), address.country].filter(
    (line): line is string => typeof line === 'string' && line !== '',
  )
}

function CompanyDetails({ company }: { company: CompanyProfile }) {
  return (
    <InformationGrid className="gap-x-4">
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
  return (
    <CompanySettingsView
      title="Company"
      description="Your company's registered details, address and contact information."
      readOnlyNotice="You can see the company details. Only company admins can change them."
    >
      {(company, isAdmin) => (
        <>
          {isAdmin ? (
            <CompanyProfileForm company={company} />
          ) : (
            <SettingsRow title="Company details" description="As recorded by your company admins.">
              <CompanyDetails company={company} />
            </SettingsRow>
          )}
          <SettingsRow
            title="Managed by Nexus Solution"
            description="These are set when the workspace is created. Contact Nexus Solution to change them."
            className="border-t border-border pt-6"
          >
            <InformationGrid className="gap-x-4">
              <InformationItem label="Workspace status" value={<StatusBadge status={company.status} />} />
              <InformationItem label="Workspace initials" value={company.initials} />
              <InformationItem label="Timezone" value={company.settings.timezone} />
              <InformationItem label="Country" value={company.address.country} />
              <InformationItem label="Currency" value="South African rand (ZAR)" />
            </InformationGrid>
          </SettingsRow>
        </>
      )}
    </CompanySettingsView>
  )
}
