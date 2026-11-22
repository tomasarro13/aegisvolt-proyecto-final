#!/usr/bin/env bash
# Smoke test post-despliegue a través del API Gateway del ambiente: el ambiente responde con su nombre,
# los 3 microservicios están UP y el catálogo de estaciones es legible.
# Uso: scripts/smoke-test.sh <env>
source "$(dirname "$0")/lib.sh"
ENV="${1:-}"; require_env "$ENV"
URL=$(terraform -chdir="$TF_DIR" output -raw graphql_url)
for attempt in 1 2 3 4 5; do
  RES=$(curl -s -m 10 -H 'content-type: application/json' \
    -d '{"query":"{ environment { name version } systemHealth { service status } stations { id } }"}' "$URL" || true)
  NAME=$(echo "$RES" | jq -r '.data.environment.name // empty' 2>/dev/null)
  DOWN=$(echo "$RES" | jq '[.data.systemHealth[]? | select(.status != "UP")] | length' 2>/dev/null || echo 1)
  STATIONS=$(echo "$RES" | jq '.data.stations | length' 2>/dev/null || echo 0)
  if [ "$NAME" = "$ENV" ] && [ "$DOWN" = "0" ] && [ "${STATIONS:-0}" -gt 0 ]; then
    log "smoke test OK: $ENV v$(echo "$RES" | jq -r .data.environment.version) · servicios UP · $STATIONS estaciones"
    exit 0
  fi
  sleep 3
done
log "smoke test FALLÓ en $ENV: ${RES:0:300}"
exit 1
