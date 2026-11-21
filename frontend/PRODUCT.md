# Product

<!-- impeccable:product-schema 1 -->

Drafted from `CLAUDE.md`, `docs/LeaseGuard MVP v1.0.pdf` and the owner's standing design rules; awaiting the owner's review.

## Platform

web

## Users

- **Company admins** at a South African commercial property management company (built for Nexus Solution). They set up the workspace, users, roles and the WhatsApp integration.
- **Property managers**, the daily users. They keep the portfolio (properties, units, tenants, leases) accurate, review statements and monitoring events, and approve every tenant message before it is sent.
- **Property owners** and **read-only** members, who look at the portfolio and its status without changing it.

They work at a desk, on a laptop or office monitor, through a working day, often across several company workspaces. Some checks happen on a phone.

## Product Purpose

LeaseGuard watches commercial leases and tenant accounts so nothing slips: escalations, lease expiries, renewal deadlines, guarantee cover, arrears ageing and payment arrangements. It drafts the statement and payment messages a tenant should receive on WhatsApp, and a property manager approves each one before it goes out. Success is a manager who knows what needs attention today and can trust every figure and every message.

## Positioning

Monitoring and communication only. LeaseGuard never collects, processes or holds money, and it never sends a tenant anything a property manager has not approved.

## Operating Context

- Lease documents and monthly tenant statements (PDFs) are uploaded and their figures extracted. Uncertain extraction is flagged for review, never guessed.
- Lease terms are verified before they drive financial monitoring.
- Tenant messaging runs through the company's own WhatsApp Business number (Meta setup, number verification, an agent configuration, a conversations inbox).
- Several companies per user: every record belongs to the active workspace.

## Capabilities and Constraints

- No payment gateways, banking integrations or transaction processing. Statement balances and payment arrangements are monitoring records.
- Tenants may only receive: monthly statement, initial / overdue / follow-up payment reminder, arrangement instalment reminder. Never escalation, lease expiry, renewal option, dispute or guarantee messages.
- Active payment arrangements suppress normal arrears reminders.
- Currency is ZAR; dates use South African conventions (en-ZA, `dd MMM yyyy`).
- The shipped app shows only data from the API and database; no hardcoded or mock business data.
- Terminology: Properties, Units, Tenants, Leases, Statements, Monitoring, Arrangements, Communications, Message approvals, WhatsApp, Reports, Settings.
- Undecided: the content of the Reports, Statements, Monitoring and Arrangements screens is still being built.

## Brand Commitments

- Name: LeaseGuard, product of Nexus Solution.
- The original blue palette is binding; the owner reverted two palette changes.
- The owner's 20 UI rules and UX rules (laws of UX, restrained motion) apply to every screen.
- The current page name lives in the top bar, never as a visible title in the page body.
- Plain, specific UK/South African English; no hype, no exclamation marks.

## Evidence on Hand

- `docs/LeaseGuard MVP v1.0.pdf` (scope), `docs/LeaseGuard_Overview.pdf`, `docs/integrations/whatsapp.md`.
- No customer testimonials, metrics, logos or case studies exist. Do not invent any.

## Product Principles

1. Nothing reaches a tenant without a person's approval.
2. Every figure is traceable to a verified lease or a reviewed statement; uncertainty is shown, not hidden.
3. What needs attention today comes first.
4. Monitoring, not money: no screen suggests LeaseGuard moves funds.

## Accessibility & Inclusion

WCAG 2.2 AA: keyboard reachable, visible focus, reduced motion honoured, touch targets of at least 40px on mobile.
