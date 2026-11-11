# Containers for local development

`docker-compose.yml` (repository root) runs the LeaseGuard services in containers:

| Service | Image | Host port | Notes |
| --- | --- | --- | --- |
| `redis` | `redis:7.4.12` | not published | append-only file in the `redis-data` volume |
| `document-processing` | built from `python-services/document-processing` | `127.0.0.1:8000` | |
| `api` | built from `backend/Dockerfile` | `127.0.0.1:3000` | |
| `worker` | same image as `api`, `node dist/worker.js` | none | |
| `frontend` (profile `frontend`) | built from `frontend/Dockerfile` | `127.0.0.1:8080` | nginx, config in `nginx/frontend.conf` |

Supabase is not in the compose file. It runs through the Supabase CLI (`pnpm db:start`), and the
containers reach it at `host.docker.internal:54321`.

```sh
cp backend/.env.example backend/.env      # once; fill in the keys printed by `pnpm db:status`
cp frontend/.env.example frontend/.env    # once; the web app's public values
pnpm db:start                   # Supabase
pnpm docker:config              # validate docker-compose.yml
pnpm docker:nginx-check         # nginx -t and cache/compression headers for nginx/frontend.conf
pnpm docker:up                  # build and start redis, document-processing, api, worker
bash infrastructure/scripts/compose.sh --profile frontend up -d --build   # also the SPA
bash infrastructure/scripts/compose.sh logs -f api worker
pnpm docker:down                # stop and remove the containers
bash infrastructure/scripts/compose.sh down -v                            # also drop the Redis volume
```

The host ports are the ones `pnpm dev` uses, so run either the containers or `pnpm dev`, or move the
containers with `API_HOST_PORT`, `DOCUMENT_PROCESSING_HOST_PORT` and `FRONTEND_HOST_PORT` (in `backend/.env`
or the shell).

Configuration comes from `backend/.env` and, for the frontend image's build arguments, `frontend/.env`. Inside containers the host names differ, so the compose
file sets `REDIS_URL=redis://redis:6379`, `SUPABASE_URL=http://host.docker.internal:54321` and
`DOCUMENT_PROCESSING_URL=http://document-processing:8000`. The API and the document-processing
service receive only their own variables; the worker receives the whole `backend/.env` because it also needs
each company's WhatsApp access-token variable, `WHATSAPP_ACCESS_TOKEN_<company uuid without dashes,
uppercase>` (for example `WHATSAPP_ACCESS_TOKEN_3AB0FC4AEADB50B8BC4D5673ADA1519E`; see
`backend/src/infrastructure/whatsapp/access-token-reference.ts`). The bare `WHATSAPP_ACCESS_TOKEN` and
name-based variables are not accepted. Tokens kept in Supabase Vault (`secret://vault/…`) need no
variable.

The frontend image compiles `VITE_API_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in at
build time (they are public, never secrets).

## `compose.sh`

`infrastructure/scripts/compose.sh` uses `docker compose` or `docker-compose` when installed and
otherwise runs Compose from the `docker:29-cli` image against the host daemon. The header of the
script lists the limitations of that fallback (repository files only, which host variables are
forwarded, local daemon socket).

## Images

See `infrastructure/deployment/README.md` for how the images are built and run in production. All
Dockerfiles avoid BuildKit-only syntax, so they build with BuildKit (Compose) and with the legacy
`docker build` builder. The two root-context images share the root `.dockerignore`.
