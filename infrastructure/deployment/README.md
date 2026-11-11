# LeaseGuard production deployment notes

What exists today and what each process needs to run in production. Nothing here assumes a specific
cloud vendor: any platform that runs OCI images, injects environment variables from a secret store
and terminates TLS in front of HTTP services will do.

LeaseGuard is monitoring and communication only. No component collects, processes or holds payments,
and none needs payment or banking credentials.

## Components

| Process | Image (Dockerfile) | Command | Port | Health |
| --- | --- | --- | --- | --- |
| API (NestJS, HTTP) | `backend/Dockerfile` | `node dist/main.js` (default) | `API_PORT` (3000) | `GET /health` liveness, `GET /health/ready` readiness |
| Worker (NestJS, BullMQ) | `backend/Dockerfile` (same image) | `node dist/worker.js` | none | no HTTP; process liveness only |
| Document processing (FastAPI) | `python-services/document-processing/Dockerfile` | default (uvicorn on 8000) | 8000 | `GET /health` liveness, `GET /health/ready` readiness |
| Frontend (static SPA on nginx) | `frontend/Dockerfile` | default | 8080 | `GET /healthz` |
| Database, Auth, Storage | Supabase (managed project) | n/a | n/a | n/a |
| Queues | Redis 7.4 | n/a | 6379 | `redis-cli ping` |

Build the Node images from the repository root (they depend on the `@leaseguard/domain` workspace
package); the Python image builds from its own directory:

```sh
docker build -f backend/Dockerfile -t leaseguard-backend:<version> .
docker build -f frontend/Dockerfile -t leaseguard-frontend:<version> \
  --build-arg VITE_API_URL=https://<api origin> \
  --build-arg VITE_SUPABASE_URL=https://<project>.supabase.co \
  --build-arg VITE_SUPABASE_ANON_KEY=<public anon key> .
docker build -t leaseguard-document-processing:<version> python-services/document-processing
```

All base images are pinned to patch releases (`node:24.22.2-trixie-slim`, `nginx:1.30.6-alpine`,
`python:3.14.10-slim-trixie`). Every image runs as a non-root user and contains no `.env` file or
secret (see the root `.dockerignore`). Tag images with an immutable version (for example the git
commit), never only `latest`.

## API and worker are separate processes

The API and the worker come from one image but must run as separate deployments:

- **API**: stateless HTTP. Scale horizontally behind a load balancer. It enqueues jobs in Redis and
  never processes them.
- **Worker**: consumes the BullMQ queues (statement processing, lease / arrears / arrangement
  monitoring, message delivery, the daily monitoring dispatch). Run with the image's `HEALTHCHECK`
  disabled (it probes the API's HTTP port). On `SIGTERM` it closes its BullMQ workers and lets
  in-flight jobs finish, so give it a stop grace period (the compose file uses 30 s).

Scaling workers: replicas can be added freely. Job ids are deterministic and processors are
idempotent, so a job enqueued twice runs once; the daily monitoring dispatch is registered with an
idempotent upsert, so every replica may register it and Redis keeps a single schedule. Per-replica
concurrency is set in code (for example statement processing 2, message delivery 4). Scale the
document-processing service with statement-processing throughput.

## Configuration per process

The variables are validated at start-up by each process (`backend/src/config/env.ts`,
`python-services/document-processing/app/core/config.py`, `frontend/src/services/api/config.ts`);
an invalid or missing value stops the process with a message naming every problem. `.env.example`
documents each variable. Give each process only its own variables.

| Variable | API | Worker | Document processing | Notes |
| --- | :-: | :-: | :-: | --- |
| `NODE_ENV` | yes | yes | | `production` |
| `LOG_LEVEL` | yes | yes | yes | `fatal` … `trace`, `silent` |
| `API_PORT` | yes | | | |
| `API_CORS_ORIGINS` | yes | | | the frontend's origin(s), comma separated |
| `SUPABASE_URL` | yes | yes | | |
| `SUPABASE_ANON_KEY` | yes | | | public key; requests run under Row Level Security |
| `SUPABASE_SERVICE_ROLE_KEY` | | yes | | **secret**; bypasses RLS; worker only, never the API or the browser |
| `SUPABASE_STATEMENTS_BUCKET` | yes | yes | | `statements` |
| `SUPABASE_LEASE_DOCUMENTS_BUCKET` | yes | yes | | `lease-documents` |
| `REDIS_URL` | yes | yes | | `rediss://` for TLS |
| `QUEUE_PREFIX` | yes | yes | | must be identical for API and worker |
| `DOCUMENT_PROCESSING_URL` | | yes | | internal URL of the Python service |
| `DOCUMENT_PROCESSING_TOKEN` | | yes | yes | **secret**; shared bearer token, at least 32 characters in production |
| `DOCUMENT_PROCESSING_MAX_FILE_MB` | yes | yes | yes | same value everywhere |
| `WHATSAPP_GRAPH_API_URL` | | yes | | `https://graph.facebook.com` |
| `WHATSAPP_GRAPH_API_VERSION` | | yes | | for example `v23.0` |
| `WHATSAPP_ACCESS_TOKEN_<COMPANY ID>` | | yes | | **secret**, one per connected company; see below |

Frontend `VITE_*` values (`VITE_API_URL`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` and the optional `VITE_GOOGLE_MAPS_API_KEY`) are build arguments compiled into the JavaScript bundle. They are public by
nature: never put a secret in a `VITE_*` variable. Changing them requires rebuilding the frontend
image.

`VITE_GOOGLE_MAPS_API_KEY` turns on address suggestions (Google Places API (New), South Africa only). It is
a browser key, visible to anyone who loads the app: in Google Cloud restrict it to the app's origins
(HTTP referrers) and to the Maps JavaScript API and Places API (New), and set a quota. While someone types
an address, that text is sent to Google; nothing else is. Without the key, address fields are plain inputs.

## Secrets

- Inject secrets from the platform's secret store as environment variables at run time. Do not bake
  them into images, commit them, or pass them as build arguments.
- `SUPABASE_SERVICE_ROLE_KEY` belongs to the worker only. The API authenticates every request with
  the caller's Supabase JWT and queries with Row Level Security.
- WhatsApp access tokens are never stored in the database. Each company's token lives in the worker
  environment variable `WHATSAPP_ACCESS_TOKEN_<COMPANY ID>`, where the company id is the company's uuid
  without dashes, in uppercase (for company `3ab0fc4a-eadb-50b8-bc4d-5673ada1519e`:
  `WHATSAPP_ACCESS_TOKEN_3AB0FC4AEADB50B8BC4D5673ADA1519E`; see
  `backend/src/infrastructure/whatsapp/access-token-reference.ts`). An env-form
  `whatsapp_phone_numbers.access_token_reference` must be exactly
  `secret://env/WHATSAPP_ACCESS_TOKEN_<COMPANY ID>` for that same company. The other accepted form,
  `secret://vault/<secret id>`, names a Supabase Vault secret called
  `whatsapp_access_token:<company id>[:<suffix>]` and needs no worker variable or restart (see
  `docs/security/README.md`). The bare `WHATSAPP_ACCESS_TOKEN` and name-based variables (such as
  `WHATSAPP_ACCESS_TOKEN_ACME`) are no longer accepted: the worker does not load them
  (`WHATSAPP_ACCESS_TOKEN_KEY` in `backend/src/config/env.ts`) and no reference can name them. Binding
  the variable to the immutable company id means a company admin can neither point the reference at
  another worker secret nor at another company's token. To connect a company: add
  `WHATSAPP_ACCESS_TOKEN_<COMPANY ID>` to the worker's secrets, restart the worker, then set the
  account's reference to `secret://env/WHATSAPP_ACCESS_TOKEN_<COMPANY ID>`. Rotating a token is a
  secret update plus a worker restart.
- Rotate `DOCUMENT_PROCESSING_TOKEN` by updating the worker and the document-processing service
  together.

## Database migrations (Supabase)

Schema, Row Level Security policies, storage buckets and their policies live in
`supabase/migrations`. Apply them to the hosted project with the Supabase CLI (a root
devDependency):

```sh
pnpm db:push:remote                    # dry run: lists the migrations that would be applied
pnpm db:push:remote -- --apply         # lists them, asks for confirmation, then applies them
pnpm db:push:remote -- --apply --yes   # applies without asking (non-interactive release step)
```

The script targets the project named by `SUPABASE_URL` and connects with `SUPABASE_DB_PASSWORD`
(process environment or the root `.env`); the password is never printed and the seed is never pushed.
By default it connects to the direct host `db.<project-ref>.supabase.co`, which is **IPv6-only**. On an
IPv4-only network, container or CI runner, set `SUPABASE_DB_POOLER_URL` to the dashboard's session-pooler
string (`postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`;
the placeholder is replaced with `SUPABASE_DB_PASSWORD`). The script refuses a pooler URL whose host is
not `*.pooler.supabase.com`, whose user is not for the `SUPABASE_URL` project, or that uses the
transaction pooler (port 6543).
Alternatively, after `pnpm exec supabase link --project-ref <project-ref>`, use
`pnpm exec supabase db push --remote` (with the pinned Supabase CLI 3, `db push` targets the local
database unless `--remote` is given).

Run migrations as a release step before rolling out API and worker versions that depend on them.
Never apply `supabase/seed.sql` to production: it contains demo users with a local-only password.
After a schema change, regenerate `backend/src/infrastructure/database/database.types.ts` locally with
`pnpm db:types` and commit it with the migration.

## Health and readiness

- API: route traffic on `GET /health/ready` (503 until Redis answers and Supabase is reachable;
  per-dependency status in the body). Use `GET /health` for liveness only; the image's `HEALTHCHECK`
  uses it.
- Document processing: `GET /health/ready` is 503 until `DOCUMENT_PROCESSING_TOKEN` is set and reports
  whether OCR (Tesseract) is available; `GET /health` is liveness.
- Frontend: `GET /healthz`.
- Worker: no HTTP endpoint. Treat process exit as failure (the platform's restart policy restarts
  it); its logs report Redis connection loss and failed jobs, and job outcomes are recorded in the
  `job_runs` table.

## Load balancing and caching

nginx in this repository is the static file server for the frontend only
(`infrastructure/docker/nginx/frontend.conf`). It does not proxy, load-balance or cache the API. Do
not add an nginx tier in front of the API on a platform that already balances replicas.

### Load balancing the API

The API is stateless: a bearer token on every request, no sessions or cookies, no in-process data
cache, no WebSockets. One replica is enough for the pilot. When more are run, use the platform's own
load balancer and hold it to these rules:

- **No session persistence.** No sticky sessions, IP hashing or cookie affinity. Use least-connections
  where the balancer offers a choice and round robin otherwise; at this scale they behave the same.
- **Health.** Route on `GET /health/ready` with an active check. `GET /health` is liveness only.
- **Retries.** Retry only when no connection to a replica could be made. Never replay a request that
  was already sent unless it is a `GET` or `HEAD`. `POST`, `PATCH`, `PUT` and `DELETE` routes send
  WhatsApp messages and invitations, remove members and change WhatsApp settings, and none of them
  takes an idempotency key.
- **Idle connections.** The API keeps an idle connection open for 65 s (`KEEP_ALIVE_TIMEOUT_MS` in
  `backend/src/main.ts`). The balancer's idle timeout towards the API must be shorter (60 s is the
  common default). Otherwise it reuses a connection the API is closing and callers see occasional
  502s.
- **Timeouts.** Allow at least 30 s for a response. The slowest call, the Meta code exchange, is
  capped at 10 s.
- **WhatsApp webhook** (`/api/v1/webhooks/whatsapp`). Allow bodies of 3 MB and pass the body and the
  `X-Hub-Signature-256` header through unmodified: Meta's signature covers the exact bytes. The `GET`
  handshake carries the secret verify token in its query string, so the balancer's access and error
  logs must not record query strings for this path. The API redacts it in its own logs.
- **Headers.** Pass `X-Request-Id` through. The API does not read the client address, so Express
  `trust proxy` is unset. When a feature needs the address (rate limiting, IP logging), set it to the
  exact number of proxy hops, never `true`.

Not built yet, and needed before a second replica serves real traffic:

1. **Drain on shutdown.** On `SIGTERM` the API should answer 503 on `/health/ready` for a few seconds
   before it closes, and the platform should give it a stop grace period. Today a request in flight
   on a stopping replica can fail.
2. **Idempotency keys on the routes that send.** `POST /whatsapp/conversations/:id/replies`,
   `/invitations`, `/invitations/:id/resend` and `/integrations/whatsapp/test-messages` create a new
   record on every call. A user who sees a 502 or 504 and presses send again can send a tenant the
   same message twice.

Self-hosting without a platform balancer has not been set up or tested. If it is ever needed, prefer
a proxy with active health checks (HAProxy, Traefik or Caddy). Open-source nginx has passive checks
only, so it cannot route on `/health/ready`, and it replays `PUT` and `DELETE` requests after a
connection error unless `proxy_next_upstream off` is set for everything except `GET` and `HEAD`.

### Caching

| Content | `Cache-Control` | Set by |
| --- | --- | --- |
| `/assets/*` (content-hashed by Vite) | `public, max-age=31536000, immutable` | frontend nginx |
| `index.html` and client-side route fallbacks | `no-cache` (revalidated; 304 when unchanged) | frontend nginx |
| `/favicon.svg` (the only unhashed file) | `public, max-age=86400` | frontend nginx |
| Every API response, including health and errors | `no-store` | `backend/src/common/http/no-store.ts` |

Never cache `/api/` or `/health` at a proxy or CDN. The company is carried in the `Authorization` and
`X-Company-Id` headers, not in the URL, so a cache keyed on the URL would serve one company's data to
another and bypass both the API guards and Row Level Security. Do not add a proxy cache, a rule that
ignores origin cache headers, or a CDN rule that caches by path or file extension on the API host.
Repeat reads are cached in the browser by TanStack Query, keyed by company id and cleared on sign-out.

A new unhashed file in `frontend/public` needs its own `location` with an explicit lifetime in
`frontend.conf`. The one-year policy is only for `/assets/`.

Checks: `pnpm docker:nginx-check` runs `nginx -t` on `frontend.conf` in the pinned image and asserts
the headers above; `tests/integration/cache-headers.test.ts` asserts `no-store` on the running API.

## Network exposure

- Public: the frontend and the API (both behind TLS). Set `API_CORS_ORIGINS` to the frontend origin.
- Internal only: the document-processing service (reachable by the worker alone) and Redis.
- The API serves its OpenAPI document at `/api/docs`; restrict it at the edge if it should not be
  public.
- The frontend nginx sets `nosniff`, `X-Frame-Options: DENY` and a referrer policy; add a
  Content-Security-Policy and HSTS at the edge, where the API and Supabase origins are known.

## Logs

All Node processes log JSON lines (pino) to stdout; the Python service logs JSON lines to stderr.
Collect both stdout and stderr; no process writes log files. Each API response carries an `x-request-id` header that
appears in the API's log lines.
