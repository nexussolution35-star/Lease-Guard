# Local setup: troubleshooting

The root `README.md` has the setup steps (the local stack; there is no demo mode). This page covers the
problems people actually hit.

## Which Supabase am I using?

The hosted Supabase project is the system of record: its schema comes only from `supabase/migrations`
(applied with `pnpm db:push:remote`, see [database](../database/README.md#applying-migrations-to-a-hosted-project)).
The local stack is for development and tests only.

`backend/.env` (server settings) and `frontend/.env` (the web app's public values) decide where the API, the
worker and the web app connect: `SUPABASE_URL` (backend) and `VITE_SUPABASE_URL` (frontend) are either the local stack (`http://127.0.0.1:54321`) or a hosted project
(`https://<ref>.supabase.co`). The keys must belong to the same project as the URL.

- `pnpm db:status` prints the **local** stack's URL and keys. Use them when `.env` should point at
  the local stack.
- The database scripts ignore `.env` and always act on the local stack: `pnpm db:reset`,
  `pnpm db:test`, `pnpm db:types` and `pnpm db:types:check` (Supabase CLI 3 targets the local
  database unless `--remote` is passed).
- `pnpm test:integration` never reads `.env`: it takes the URL and keys from `supabase status` and
  refuses to run unless they are on this machine.
- Containers started with `pnpm docker:up` use the local stack at `host.docker.internal:54321` unless
  `DOCKER_SUPABASE_URL` is set in `.env`.

If the web app signs in but shows no data, or the API reports `/health/ready` as 503, check that the
URL and the keys come from the same project and that the stack is running (`pnpm db:status`).

## Redis for `pnpm dev`

The API and the worker started by `pnpm dev` use `REDIS_URL` (default `redis://127.0.0.1:6379`). The
`redis` service in `docker-compose.yml` does **not** publish a host port, so it serves only the
containers. For host processes, run a separate Redis, for example:

```sh
docker run -d --name leaseguard-redis-dev -p 127.0.0.1:6379:6379 redis:7.4.12
```

While Redis is down the API stays up but `/health/ready` is 503, and the worker logs one warning per
outage and keeps retrying.

## Docker Compose is not installed

`pnpm docker:config`, `docker:up` and `docker:down` run `infrastructure/scripts/compose.sh`. It uses
`docker compose` or `docker-compose` when available and otherwise runs Compose from the
`docker:29-cli` image against your local daemon. You see
`compose.sh: no local Docker Compose found; using docker:29-cli` when the fallback is used. The
script header lists its limitations (repository files only, only some host variables forwarded,
local daemon socket). Set `COMPOSE_FORCE_FALLBACK=1` to use the fallback even when Compose is
installed.

## `docker build` fails without buildx (for example on Colima)

Recent Docker CLIs build with BuildKit by default and fail when the buildx component is missing.
The LeaseGuard Dockerfiles avoid BuildKit-only syntax, so the legacy builder works:

```sh
DOCKER_BUILDKIT=0 docker build -f backend/Dockerfile -t leaseguard-backend:local .
```

Build the backend and frontend images from the repository root; the document-processing image from
`python-services/document-processing`.

## Ports already in use

The containers publish the same host ports `pnpm dev` uses (API 3000, document processing 8000,
frontend container 8080). Stop one before starting the other, or move the containers with
`API_HOST_PORT`, `DOCUMENT_PROCESSING_HOST_PORT` and `FRONTEND_HOST_PORT` in `.env`.

## Sign-in is rejected or rate-limited locally

- The local database starts empty: there are no seeded users. Create your own user, company and
  membership in the local Supabase Studio (see the README); the test suites create their own users
  per run and delete them afterwards.
- Local Supabase Auth limits sign-in and sign-up requests (`sign_in_sign_ups = 30` per 5 minutes per
  IP in `supabase/config.toml`). Repeated manual sign-ins or test runs can hit it; wait for the window
  to pass.
- A signed-in user with no company membership, or without a LeaseGuard profile, sees
  "No workspace access".

## The API or worker refuses to start

Each process lists every missing or invalid variable and the file it reads (`backend/src/config/env.ts`).
Two variables may be empty while the local stack is not started yet:

- `SUPABASE_ANON_KEY` (API): the API starts, but `/health/ready` is 503 and authenticated requests
  get 503.
- `SUPABASE_SERVICE_ROLE_KEY` (worker): the worker starts, but jobs that need the database fail.

The worker refuses to start in production (`NODE_ENV=production`) with a `DOCUMENT_PROCESSING_TOKEN`
shorter than 32 characters.

## The web app shows a configuration error

`frontend/src/services/api/config.ts` validates the `VITE_*` variables at start-up.
`VITE_API_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are required; other `VITE_*` variables
are ignored. If a `VITE_*` variable
holds a Supabase secret or service-role key, `pnpm dev:frontend` and the frontend build refuse to run.
Vite reads `frontend/.env`; restart the dev server after changing it. A `VITE_*` copy of any server-only
setting (for example `VITE_GOOGLE_MAPS_API_KEY`) is refused.

## Document processing without OCR

Tesseract is optional locally. Without it, scanned pages are reported as issues rather than read, and
`GET /health/ready` on the service reports `ocrAvailable: false`. The container image includes it.
