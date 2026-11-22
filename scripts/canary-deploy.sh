#!/usr/bin/env bash
# =============================================================================
# Canary Deployment de un microservicio en Kubernetes.
#  1. Despliega <svc>-canary (1 réplica) junto a <svc>-stable (4 réplicas) => ~20 % del tráfico.
#  2. Genera tráfico real a través del API Gateway durante ANALYSIS_SECONDS.
#  3. Analiza en CloudWatch Logs (/aegisvolt/<env>/<svc>) los logs con track=canary:
#       tasa_error = errores / requests  (umbral MAX_ERROR_RATE, mínimo MIN_REQUESTS)
#     y verifica que los pods canary estén Ready y sin reinicios.
#  4. Éxito => promueve (stable adopta la imagen, 100 %) y elimina el canary.
#     Falla  => rollback automático (se elimina el canary; stable nunca cambió) y exit 1.
# Uso: scripts/canary-deploy.sh <env> <servicio> <imagen> <versión>
# =============================================================================
source "$(dirname "$0")/lib.sh"
ENV="$1"; SVC="$2"; IMAGE="$3"; VERSION="$4"
require_env "$ENV"
: "${KUBECONFIG:?Defina KUBECONFIG}"
CANARY_WEIGHT_STABLE="${CANARY_STABLE_REPLICAS:-4}"   # 4 stable : 1 canary = 20 %
ANALYSIS_SECONDS="${ANALYSIS_SECONDS:-45}"
MAX_ERROR_RATE="${MAX_ERROR_RATE:-0.05}"
MIN_REQUESTS="${MIN_REQUESTS:-3}"
PORT=$(service_port "$SVC")
NS=aegisvolt
LOG_GROUP="/aegisvolt/$ENV/$SVC"
K="kubectl -n $NS"

record_decision() { # deja la decisión del canary auditada en CloudWatch (/aegisvolt/<env>/canary)
  local decision="$1" detail="$2" stream="canary-$(date +%Y%m%d)"
  aws logs create-log-stream --log-group-name "/aegisvolt/$ENV/canary" --log-stream-name "$stream" >/dev/null 2>&1 || true
  local msg events
  msg=$(jq -cn --arg s "$SVC" --arg v "$VERSION" --arg d "$decision" --arg e "$ENV" --argjson x "$detail" \
    '{level:"info",message:"canary decision",service:$s,version:$v,decision:$d,environment:$e,analysis:$x}')
  events=$(jq -cn --arg m "$msg" --argjson t "$(($(date +%s)*1000))" '[{timestamp:$t, message:$m}]')
  aws logs put-log-events --log-group-name "/aegisvolt/$ENV/canary" --log-stream-name "$stream" --log-events "$events" >/dev/null \
    || log "no se pudo registrar la decisión en CloudWatch"
}

STABLE_IMAGE=$($K get deploy "$SVC-stable" -o jsonpath='{.spec.template.spec.containers[0].image}')
STABLE_REPLICAS=$($K get deploy "$SVC-stable" -o jsonpath='{.spec.replicas}')

if [ "$STABLE_IMAGE" = "$IMAGE" ]; then
  if $K get deploy "$SVC-stable" -o jsonpath='{.status.readyReplicas}' | grep -q '[1-9]'; then
    log "$SVC: la versión $VERSION ya es la estable; nada que hacer"
    exit 0
  fi
  log "$SVC: primer despliegue de $VERSION (sin versión previa: no aplica canary)"
  $K rollout status deploy/"$SVC-stable" --timeout=180s
  exit 0
fi

log "$SVC: CANARY $VERSION | stable=$STABLE_IMAGE"
$K scale deploy "$SVC-stable" --replicas="$CANARY_WEIGHT_STABLE" >/dev/null
# Caos solo para la demo: en todos los servicios o solo en CANARY_CHAOS_SERVICE si está definido.
CHAOS="${CANARY_CHAOS_ERROR_RATE:-0}"
if [ -n "${CANARY_CHAOS_SERVICE:-}" ] && [ "$CANARY_CHAOS_SERVICE" != "$SVC" ]; then CHAOS=0; fi
export SERVICE="$SVC" VERSION IMAGE PORT CANARY_REPLICAS=1 CHAOS_ERROR_RATE="$CHAOS"
[ "$CHAOS_ERROR_RATE" != "0" ] && log "$SVC: DEMO -> el canary inyectará ${CHAOS_ERROR_RATE} de errores (debe hacer ROLLBACK)"
envsubst < "$ROOT_DIR/k8s/canary/deployment.tmpl.yaml" | $K apply -f - >/dev/null

rollback() {
  log "$SVC: ROLLBACK automático -> se elimina el canary, stable continúa con $STABLE_IMAGE"
  $K delete deploy "$SVC-canary" --ignore-not-found >/dev/null
  $K scale deploy "$SVC-stable" --replicas="$STABLE_REPLICAS" >/dev/null
  record_decision "ROLLBACK" "${1:-"{}"}"
  exit 1
}

if ! $K rollout status deploy/"$SVC-canary" --timeout=120s; then
  rollback '{"reason":"canary pods not ready"}'
fi

START_MS=$(($(date +%s) * 1000))
GRAPHQL_URL=$(tf_output graphql_url)
log "$SVC: análisis durante ${ANALYSIS_SECONDS}s (1 canary : $CANARY_WEIGHT_STABLE stable = ~20 % del tráfico)"
# 1) Tráfico sintético dentro del clúster contra el Service (wget = una conexión por request).
case "$SVC" in
  graphql-gateway) PROBE="wget -qO- --header 'content-type: application/json' --post-data '{\"query\":\"{ environment { version track } stations { id } wallets { fleetId } }\"}' http://$SVC:$PORT/graphql" ;;
  station-reservation-service) PROBE="wget -qO- http://$SVC:$PORT/stations" ;;
  billing-wallet-service) PROBE="wget -qO- http://$SVC:$PORT/wallets" ;;
  energy-dispatch-service) PROBE="wget -qO- 'http://$SVC:$PORT/sessions?limit=5'" ;;
esac
$K delete pod "canary-probe-$SVC" --ignore-not-found >/dev/null 2>&1
$K run "canary-probe-$SVC" --image="$STABLE_IMAGE" --restart=Never --labels="role=canary-probe" --command -- \
  sh -c "end=\$((\$(date +%s)+$ANALYSIS_SECONDS)); while [ \$(date +%s) -lt \$end ]; do $PROBE >/dev/null 2>&1; sleep 0.2; done" >/dev/null
# 2) Tráfico real de punta a punta a través del API Gateway (vista del cliente).
END=$(( $(date +%s) + ANALYSIS_SECONDS ))
QUERY='{"query":"{ environment { version track } stations { id availableConnectors } wallets { fleetId balance } chargingSessions(limit: 5) { sagaId } featureFlags { key enabled } }"}'
while [ "$(date +%s)" -lt "$END" ]; do
  curl -s -o /dev/null -m 5 -H 'content-type: application/json' -d "$QUERY" "$GRAPHQL_URL" || true
  sleep 0.5
done
$K delete pod "canary-probe-$SVC" --ignore-not-found --wait=false >/dev/null 2>&1
sleep 5 # margen para que el CloudWatchSink haga flush

EVENTS=$(aws logs filter-log-events --log-group-name "$LOG_GROUP" --start-time "$START_MS" --query 'events[].message' --output json 2>/dev/null || echo '[]')
REQUESTS=$(echo "$EVENTS" | jq '[.[] | fromjson? | select(.track=="canary" and .message=="request completed")] | length')
ERRORS=$(echo "$EVENTS" | jq '[.[] | fromjson? | select(.track=="canary" and .level=="error")] | length')
RESTARTS=$($K get pods -l "app=$SVC,track=canary" -o jsonpath='{range .items[*]}{.status.containerStatuses[0].restartCount}{"\n"}{end}' | awk '{s+=$1} END {print s+0}')
RATE=$(awk -v e="$ERRORS" -v r="$REQUESTS" 'BEGIN { if (r == 0) print 0; else printf "%.4f", e / r }')
ANALYSIS=$(jq -cn --argjson req "$REQUESTS" --argjson err "$ERRORS" --argjson rst "$RESTARTS" --arg rate "$RATE" --arg max "$MAX_ERROR_RATE" \
  '{requests:$req, errors:$err, error_rate:($rate|tonumber), max_error_rate:($max|tonumber), restarts:$rst}')
log "$SVC: métricas canary (CloudWatch) => $ANALYSIS"

if [ "$RESTARTS" -gt 0 ]; then rollback "$ANALYSIS"; fi
if [ "$REQUESTS" -lt "$MIN_REQUESTS" ]; then log "$SVC: tráfico insuficiente hacia el canary"; rollback "$ANALYSIS"; fi
if awk -v r="$RATE" -v m="$MAX_ERROR_RATE" 'BEGIN { exit !(r > m) }'; then rollback "$ANALYSIS"; fi

log "$SVC: umbral cumplido -> PROMOVIENDO $VERSION al 100 %"
$K set image deploy/"$SVC-stable" app="$IMAGE" >/dev/null
$K set env deploy/"$SVC-stable" SERVICE_VERSION="$VERSION" >/dev/null
$K rollout status deploy/"$SVC-stable" --timeout=180s
$K scale deploy "$SVC-stable" --replicas="$STABLE_REPLICAS" >/dev/null
$K delete deploy "$SVC-canary" --ignore-not-found >/dev/null
record_decision "PROMOTED" "$ANALYSIS"
log "$SVC: canary promovido"
