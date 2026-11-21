# Services are extracted one capability at a time

LeaseGuard moves from a modular monolith to independently deployable services so that each capability can be deployed and scaled on its own (owner decision, 21 Nov 2026). The change is incremental. The current NestJS backend and its worker carry on as the core service. Every new capability is built as its own service under `services/<name>`, and existing modules are extracted later, one at a time, behind the same contracts. Reports is the first.

Each service has:
- its own package, Docker image, health and readiness endpoints, and OpenAPI document;
- its own deploy, scaled on its own;
- its own login checks: it verifies the Supabase JWT itself and applies the active company header, through a shared service kit.

The frontend reaches every service through one gateway that routes by path, such as `/api/v1/reports` to the reports service. The routing is done by a reverse proxy in deployment and by the Vite proxy in development, so a service can move without frontend changes.

Services talk to each other asynchronously through Redis/BullMQ queues and never call each other's databases tables to write. One example: the weekly owner summary is computed by the reports service and handed to the core messaging pipeline. That pipeline alone sends WhatsApp messages and records delivery.

Supabase Postgres stays the one system of record:
- Each service owns its own tables and migrations, and writes only those.
- It reads other services' data through read-only views or functions granted to it, under the same Row Level Security.
- A database per service was rejected. Company isolation is enforced by RLS on related rows; splitting the data would mean copying it between services and enforcing isolation in each copy.
