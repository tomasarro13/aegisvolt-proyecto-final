#!/usr/bin/env bash
# Ejecuta los 4 microservicios y el frontend como procesos locales contra las tablas del ambiente
# en Floci (útil en CI para e2e y para desarrollo sin Kubernetes).
# Uso: scripts/run-local.sh <env> [--background]
source "$(dirname "$0")/lib.sh"
ENV="${1:-dev}"; MODE="${2:-}"
require_env "$ENV"
mkdir -p "$ROOT_DIR/.local-logs"
export PREFECT_API_URL="${PREFECT_API_URL:-http://localhost:4200/api}" ENVIRONMENT="$ENV" CLOUDWATCH_ENABLED=true SURGE_PEAK_HOURS="${SURGE_PEAK_HOURS:-0-24}" TELEMETRY_INTERVAL_MS=2000 SERVICE_VERSION=local
pids=()
start() { # nombre puerto
  PORT="$2" node "$ROOT_DIR/services/$1/dist/main.js" > "$ROOT_DIR/.local-logs/$1.log" 2>&1 & pids+=($!)
}
start station-reservation-service 4001
start billing-wallet-service 4002
start energy-dispatch-service 4003
PORT=4000 STATION_SERVICE_URL=http://localhost:4001 BILLING_SERVICE_URL=http://localhost:4002 DISPATCH_SERVICE_URL=http://localhost:4003 \
  node "$ROOT_DIR/services/graphql-gateway/dist/main.js" > "$ROOT_DIR/.local-logs/graphql-gateway.log" 2>&1 & pids+=($!)

GQL_URL="${GRAPHQL_URL:-http://localhost:4000/graphql}"
UPPER=$(echo "$ENV" | tr "[:lower:]" "[:upper:]")
( cd "$ROOT_DIR/frontend" && env "GRAPHQL_URL_${UPPER}=$GQL_URL" DEFAULT_ENVIRONMENT="$ENV" npx next start -p 3100 > "$ROOT_DIR/.local-logs/frontend.log" 2>&1 ) & pids+=($!)

for port in 4001 4002 4003 4000; do
  for i in $(seq 1 40); do curl -sf "http://localhost:$port/health/ready" >/dev/null && break; sleep 0.5; done
  curl -sf "http://localhost:$port/health/ready" >/dev/null || fail "servicio en puerto $port no quedó listo (ver .local-logs)"
done
for i in $(seq 1 60); do curl -sf http://localhost:3100/api/environments >/dev/null && break; sleep 1; done
log "ambiente $ENV corriendo localmente: GraphQL http://localhost:4000/graphql · Frontend http://localhost:3100 (API vía $GQL_URL)"
if [ "$MODE" != "--background" ]; then
  trap 'kill ${pids[*]} 2>/dev/null' EXIT INT TERM
  wait
fi
