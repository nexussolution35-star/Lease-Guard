# Tenant messages always need an approval

Every outbound tenant message needs an approval from a company member before it is sent, and there is no per-company setting to turn this off. The PRD makes approval a hard constraint, and an earlier per-company switch meant three different things in the domain rules, the backend and the database. Per-business AI agents therefore draft tenant messages for approval; they never send them directly.
