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

**Lease terms**:
The parts of a lease that drive financial monitoring: its tenant, property and unit, dates, rentals and due day, escalation, renewal option, deposit and bank guarantee. Changing any term of a verified lease returns it to pending verification; its reference and notes are not terms.

**Lease document**:
A PDF kept on a lease as a record (signed lease, addendum, renewal agreement, bank guarantee, deposit receipt, FICA documents or other), with who uploaded it and when; once recorded it is neither replaced nor deleted.
_Avoid_: Attachment, file

**Portfolio import**:
A batch made from one CSV or XLSX file a company exported from its own system (or a copy of a Google Sheet read from its link), to add properties with their units, or units of one property, optionally with each unit's tenant from the file's tenant columns; its rows are kept with the original file and nothing is written to properties, units or tenants until the import is approved.
_Avoid_: Bulk upload, data load, migration

**Column mapping**:
Which column of a portfolio import's file each LeaseGuard field is read from; suggested from the headings only, changed by a person, and reused for the company's next file with the same headings.
_Avoid_: Field mapping, schema mapping

**Row result**:
What checking a portfolio import row against LeaseGuard found: new, matches existing, suggested match (its tenant may be an existing tenant and waits for the manager), conflict (the record exists with other values), invalid, duplicate within the file, or skipped by the manager.
_Avoid_: Row status, match score

**Suggested tenant match**:
A tenant in LeaseGuard whose name is like a portfolio import row's tenant but who shares no registration number or account reference with it. Only a suggestion: the manager confirms which tenant it is or rejects it (a new tenant is then created); tenants are never matched or merged on similar names alone.
_Avoid_: Fuzzy match, probable match, auto-match

**Account reference**:
A tenant's code in the company's own property-management or accounting system (tenant, debtor or customer code), unique per company; with the registration number, the identifier a portfolio import matches tenants by.
_Avoid_: Tenant ID, customer number

**Row fix**:
What a manager changes on a portfolio import row before approval: a corrected value (read instead of the file's cell), a skip (the row is left out), a link to an existing property or unit (nothing new is created for it), or a decision on a suggested tenant match. Kept on the import, never on the live records, and signed off with who made it and when.
_Avoid_: Override, row edit, exception resolution

**Import approval**:
A company admin's or property manager's sign-off on a portfolio import that creates its new properties, units and tenants in LeaseGuard, all together or not at all, through the same write path as the property, unit and tenant forms. Rows still blocked (invalid, conflict, duplicate, suggested match) stay out until they are fixed and the import is approved again; records that already exist are never created twice, and approving never enables or sends tenant messaging.
_Avoid_: Commit, publish, go live, activation

**Statement**:
A tenant's account statement imported from the property-management system, used for monitoring only.
_Avoid_: Invoice, bill

**Upload batch**:
The statement PDFs a person uploads together for one property and source system. Each file is checked, registered and processed on its own; the batch only groups them so they can be followed on the statement list. A file identical to one already on record, or repeated within the batch, is linked to that statement and never processed twice.
_Avoid_: Import, bulk upload

**Flagged field**:
A value read from a statement that LeaseGuard is not sure of: missing, low in confidence, not reconciling with the other figures, or different from what the uploader typed. A person must confirm or correct it; it is never guessed. Once confirmed or corrected (or found without a flag in the first place) a field is resolved; a value that was not found can only be entered, never confirmed.
_Avoid_: Error, warning, low-confidence value

**Statement verification**:
A company admin's or property manager's confirmation that every field of a statement is resolved and that it belongs to the right tenant, unit and lease. Only a verified statement's figures count for arrears, escalation checks and balances. A statement under review with nothing left unresolved is **ready to verify**; several ready statements can be verified together, each still verified and audited on its own.
_Avoid_: Approval, confirmation

**Outstanding balance**:
What a tenant's latest verified statement says they owe. A monitoring record, never a transaction; arrears ageing is measured from that statement's date.
_Avoid_: Debt, amount owing, account balance

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

**Number import**:
A Nexus operator's connection of Nexus Solution's own WhatsApp number, the test number configured for the installation, to one named company before Meta approves LeaseGuard's app; its token is stored for that company only, and the number counts as connected only after number verification, like one from a WhatsApp signup. Every other business connects through WhatsApp signup.
_Avoid_: Manual connection, token import, test-number channel

**Registration PIN**:
The 6-digit two-step verification PIN a company admin enters so LeaseGuard can register a business number with Meta; it is used once and never stored.
_Avoid_: Password, code (which reads as the Embedded Signup code)

**Receiving number**:
The company's business phone number that an inbound WhatsApp message was sent to; it, not the sender's number, identifies which company the message belongs to.

**Account holder**:
A company with verified access to a WhatsApp Business Account: LeaseGuard stored a business token for it through WhatsApp signup, or verified and connected one of its numbers. Meta's account-level events (removal of LeaseGuard, template status, number quality) name only the account and apply to its holders; a company that merely typed the same account id is not a holder.
_Avoid_: Owner (of an account), subscriber

**Disconnected in Meta**:
A business number LeaseGuard disconnected because Meta reported that the business removed LeaseGuard, or the WhatsApp Business Account was deleted or offboarded. Its stored token, when LeaseGuard holds one in Vault that nothing else of the company uses, is deleted, and the company's admins are notified; it is used again only after a new WhatsApp signup.
_Avoid_: Uninstalled number, revoked number

**Conversation**:
The thread of WhatsApp messages between one contact (or tenant) and one of a company's receiving numbers; it records when the person last wrote, which opens WhatsApp's 24-hour customer service window.
_Avoid_: Chat, ticket, thread (in user-facing text)

**Inbox**:
The list of a company's conversations, most recent first, where members read inbound WhatsApp messages.
_Avoid_: Messages page, chat list

**Customer service window**:
WhatsApp's 24 hours after a contact's last message, during which the business may send free-form text; outside it only approved templates can be sent.
_Avoid_: Session, reply window (except as short UI text), CSW

**Handover**:
A request for a person to take over a conversation, from the company's AI agent or from a member who takes it over; it is open, accepted by the member who handles it, or resolved, and a conversation has at most one that is not resolved.
_Avoid_: Escalation (which is a rental increase), ticket, transfer

**Contact reply**:
A free-form WhatsApp message a company writer sends to a contact inside the customer service window, approved by its author; never sent to a tenant.
_Avoid_: Manual message, tenant reply

**Business-scoped user id**:
Meta's identifier for a WhatsApp user within one business (BSUID); Meta may send it instead of the person's phone number, so a contact can be known without a number.
_Avoid_: WhatsApp id (which reads as the phone number Meta calls wa_id)

**Webhook event**:
One signed payload Meta delivered to LeaseGuard's shared WhatsApp webhook, stored once and recorded with what routing did with each change; it is not visible to companies.
_Avoid_: Notification, callback (as the record)

**AI agent**:
A company's own WhatsApp assistant that may answer contacts' common questions from that company's approved knowledge, within the settings its company admins chose; it never answers a tenant automatically and hands anything else to a person.
_Avoid_: Bot, chatbot, assistant (as the record), AI (on its own)

**Knowledge base**:
A company's FAQs, knowledge entries and documents for its AI agent; each item is a draft or approved, and only approved items ever reach the agent.
_Avoid_: Training data, content library

**Approved knowledge**:
Knowledge base items a company admin has approved; changing one makes it a draft again until it is approved anew.
_Avoid_: Published, live

**Handover contact**:
A company admin or property manager whom the company told the AI agent to notify when it hands a conversation to a person.
_Avoid_: Escalation contact, agent owner

**Auto-reply**:
A company's choice to let its AI agent answer contacts on its own; off until a company admin turns it on, and never applies to tenants.
_Avoid_: Automation, autopilot

**Agent run**:
What the AI agent did with one inbound message: answered it, sent the out-of-hours message, handed it to a person, or found nothing to answer; there is at most one per message.
_Avoid_: Agent job, AI call

**Suggested reply**:
The answer the AI agent drafted for staff when it hands a message to a person; internal, never sent.
_Avoid_: Draft (a draft is an unsent message or knowledge item), auto-reply

**Out-of-hours message**:
The company's message the AI agent sends a contact who writes outside operating hours, at most once per closed period and 24 hours, never to a tenant.
_Avoid_: Away message, auto-response

**WhatsApp setup**:
A company's ten steps to WhatsApp readiness (business profile, Meta account, WhatsApp Business Account, phone number, webhook, message templates, AI agent, knowledge base, test message, ready for activation); a step is done only when LeaseGuard has verified it, and the AI agent and knowledge base are recommended rather than required.
_Avoid_: Onboarding (on its own, which reads as the company's setup checklist), health check

**Test message**:
An approved WhatsApp template a company admin sends from a connected business number to a number they enter, never a tenant's, to prove the channel end to end; it counts only once Meta reports it delivered or read, and it is not a communication.
_Avoid_: Ping, sample message

**WhatsApp activation**:
A company admin's recorded decision that the company is live on WhatsApp, refused until every required WhatsApp setup step is verified.
_Avoid_: Go-live switch, enabling WhatsApp (which reads as connecting a number)

**Communication analytics**:
A company's WhatsApp figures over a range of South African calendar days: messages received and sent (with how many WhatsApp reported delivered, read or failed), handovers opened, and the AI agent's answers, out-of-hours messages and suggested replies; only that company's own records count, and test messages never do.
_Avoid_: Reports (which are portfolio reports), statistics, insights
