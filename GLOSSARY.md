# LeaseGuard

Lease monitoring and tenant communication for commercial property managers. LeaseGuard monitors leases,
statements and arrears, and communicates with tenants; it never handles payments.

## Organisations and people

**Company**:
A business that subscribes to LeaseGuard and owns its own records, users and WhatsApp channel. Every
company's data is isolated from every other company's.
_Avoid_: Tenant (in the SaaS sense), organisation, business account, workspace (workspace is only the UI's name for the active company)

**Member**:
A person with a role in a company (company admin, property manager, property owner or read-only).
_Avoid_: User (when the company role matters), staff

**Invitation**:
A company's offer of membership to an email address, which only becomes a membership when the invitee accepts it.

**Nexus operator**:
A person at Nexus Solution who creates companies on the platform; not a member of those companies.
_Avoid_: Super admin, platform admin

**Tenant**:
A lessee of a unit in a company's portfolio, and the only kind of counterparty that receives tenant messages.
_Avoid_: Customer, client, occupant

**Contact**:
A WhatsApp counterparty of a company who is not (yet) identified as a tenant, such as an enquiry from an unknown number.
_Avoid_: Customer, lead

## Leases and money

**Lease**:
The agreement between a company's landlord client and a tenant for a unit, whose terms must be verified before they drive monitoring.

**Statement**:
A tenant's account statement imported from the property-management system, used for monitoring only.
_Avoid_: Invoice, bill

**Payment arrangement**:
An agreed schedule for a tenant to settle arrears; a monitoring record, not a transaction. An active one suppresses normal arrears reminders.
_Avoid_: Payment plan, instalment agreement

**Monitoring event**:
A finding raised by LeaseGuard (for example an expiring lease or an escalation discrepancy) for a person to review.
_Avoid_: Alert, issue, ticket

## Communication

**Communication**:
One message between a company and a counterparty on a channel, inbound or outbound, with its delivery status.
_Avoid_: Message (when the record is meant), notification

**Tenant message**:
An outbound communication to a tenant. Only statement and payment-related types are allowed, and each one needs an approval before it is sent.
_Avoid_: Tenant notification, reminder (as the general term)

**Approval**:
A company member's recorded decision to release, or reject, a specific tenant message.
_Avoid_: Sign-off, review

**Deliverable**:
The state of an outbound communication that passes every rule for sending right now; a communication that is not deliverable has one or more blockers.

**WhatsApp channel**:
A company's connection to WhatsApp through one of its own registered business phone numbers, used to send and receive its communications.
_Avoid_: WhatsApp integration, WhatsApp account (when the sending capability is meant)

**WhatsApp Business Account**:
A company's account at Meta that holds its business numbers and message templates; a company may have several.
_Avoid_: WABA (in user-facing text), business account (on its own, which reads as Company)

**Business number**:
One of a company's WhatsApp phone numbers, belonging to one of its WhatsApp Business Accounts. A company may have several; a number counts as connected only after LeaseGuard has verified it with Meta.
_Avoid_: WhatsApp account, line

**WhatsApp signup**:
A company admin's single attempt to connect the company's WhatsApp Business through Meta's Embedded Signup; it expires after a few minutes, can be completed only once, and only by the admin who started it.
_Avoid_: Onboarding (on its own, which reads as the company's setup checklist), Embedded Signup session (in user-facing text)

**Number verification**:
LeaseGuard's checks with Meta before a business number is connected: the business token covers its WhatsApp Business Account, Meta lists the number there, LeaseGuard receives the account's webhooks, the number is registered for the Cloud API, and the account's message templates are synced. The number is connected only when every check passes; otherwise the failed check and how to recover are shown.
_Avoid_: Health check, onboarding (for this step)

**Registration PIN**:
The 6-digit two-step verification PIN a company admin enters so LeaseGuard can register a business number with Meta; it is used once and never stored.
_Avoid_: Password, code (which reads as the Embedded Signup code)

**Receiving number**:
The company's business phone number that an inbound WhatsApp message was sent to; it, not the sender's number, identifies which company the message belongs to.
