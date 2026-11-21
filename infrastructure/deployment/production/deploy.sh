#!/usr/bin/env bash
# Deploys (or rolls back to) one image tag on the server, from the directory holding compose.yml and .env:
#
#   ./deploy.sh <tag>      set IMAGE_TAG=<tag> in .env, pull the images, restart what changed, wait for health
#   ./deploy.sh            the same with the IMAGE_TAG already in .env
#
# <tag> is a commit SHA pushed by CI (ghcr.io/<owner>/leaseguard-<name>:<sha>). Rolling back is deploying the
# previous SHA. Run by the CI deploy job over SSH, or by hand. Never applies database migrations.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

[[ -f .env ]] || {
  echo "deploy: no .env here (copy .env.example; see docs/deployment/README.md)" >&2
  exit 1
}
if [[ $# -gt 0 ]]; then
  [[ "$1" =~ ^[A-Za-z0-9_.-]{1,128}$ ]] || {
    echo "deploy: '$1' is not an image tag" >&2
    exit 1
  }
  previous="$(sed -n 's/^IMAGE_TAG=//p' .env)"
  sed -i.bak "s/^IMAGE_TAG=.*/IMAGE_TAG=$1/" .env && rm -f .env.bak
  echo "deploy: IMAGE_TAG ${previous:-unset} -> $1 (roll back with ./deploy.sh ${previous:-<previous sha>})"
fi

docker compose pull --quiet
docker compose up -d --remove-orphans

# Wait until every container with a health check reports healthy (5 minutes at most).
for _ in $(seq 1 60); do
  waiting="$(docker compose ps --format '{{.Service}} {{.Health}}' | awk '$2 != "" && $2 != "healthy" { print $1 }' | sort -u)"
  [[ -z "$waiting" ]] && break
  sleep 5
done
docker compose ps --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}'
if [[ -n "$waiting" ]]; then
  echo "deploy: not healthy yet: $waiting (docker compose logs <service>)" >&2
  exit 1
fi
# Old images are kept for a quick rollback; remove only untagged layers.
docker image prune -f >/dev/null
echo "deploy: done"
