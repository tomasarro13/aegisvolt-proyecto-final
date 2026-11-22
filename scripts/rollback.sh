#!/usr/bin/env bash
# Rollback de un ambiente.
#   scripts/rollback.sh <env> <snapshot.json>  -> restaura EXACTAMENTE las imágenes de la foto previa al despliegue
#   scripts/rollback.sh <env>                  -> `kubectl rollout undo` (revisión anterior) de cada Deployment stable
source "$(dirname "$0")/lib.sh"
ENV="${1:-}"; SNAPSHOT="${2:-}"
require_env "$ENV"
export KUBECONFIG; KUBECONFIG=$(kubeconfig_for "$ENV")
K="kubectl -n aegisvolt"
log "ROLLBACK de $ENV ${SNAPSHOT:+(foto $SNAPSHOT)}"
$K delete deploy -l track=canary --ignore-not-found >/dev/null   # ningún canary queda vivo
for svc in "${SERVICES[@]}"; do
  if [ -n "$SNAPSHOT" ]; then
    img=$(jq -r --arg s "$svc" '.[$s].image // empty' "$SNAPSHOT")
    ver=$(jq -r --arg s "$svc" '.[$s].version // empty' "$SNAPSHOT")
    current=$($K get deploy "$svc-stable" -o jsonpath='{.spec.template.spec.containers[0].image}')
    if [ -n "$img" ] && [ "$img" != "$current" ]; then
      $K set image deploy/"$svc-stable" app="$img" >/dev/null
      [ -n "$ver" ] && $K set env deploy/"$svc-stable" SERVICE_VERSION="$ver" >/dev/null
      log "$svc: ${current##*/} -> ${img##*/}"
    else
      log "$svc: sin cambios (${current##*/})"
      continue
    fi
  else
    $K rollout undo deploy/"$svc-stable" >/dev/null && log "$svc: rollout undo"
  fi
  $K rollout status deploy/"$svc-stable" --timeout=180s >/dev/null
done
stream="rollback-$(date +%Y%m%d)"
aws logs create-log-stream --log-group-name "/aegisvolt/$ENV/canary" --log-stream-name "$stream" >/dev/null 2>&1 || true
msg=$(jq -cn --arg e "$ENV" '{level:"warn",message:"environment rollback",environment:$e}')
aws logs put-log-events --log-group-name "/aegisvolt/$ENV/canary" --log-stream-name "$stream" \
  --log-events "$(jq -cn --arg m "$msg" --argjson t "$(($(date +%s)*1000))" '[{timestamp:$t,message:$m}]')" >/dev/null || true
log "rollback de $ENV completado"
