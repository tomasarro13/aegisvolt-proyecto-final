#!/usr/bin/env bash
# =============================================================================
# Pipeline de CD de un ambiente (lo mismo que ejecuta .github/workflows/cd.yml tras un merge):
#   1. Foto de las imágenes actualmente estables (para rollback de todo el ambiente)
#   2. terraform apply SOLO en el workspace del ambiente
#   3. Build + push a ECR + Canary por servicio (rollback automático del servicio que falle)
#   4. Smoke test a través del API Gateway
#   Si el paso 3 o 4 falla => rollback de TODOS los servicios a la foto (ambiente consistente).
# Uso: scripts/cd.sh <env> <versión>
# =============================================================================
source "$(dirname "$0")/lib.sh"
ENV="${1:-}"; VERSION="${2:-}"
require_env "$ENV"; [ -n "$VERSION" ] || fail "Falta la versión"
log "═══ CD $ENV · versión $VERSION ═══"

tf_select "$ENV"
export KUBECONFIG; KUBECONFIG=$(kubeconfig_for "$ENV")
SNAPSHOT="$ROOT_DIR/.local-logs/snapshot-$ENV-$(date +%Y%m%d-%H%M%S).json"
mkdir -p "$ROOT_DIR/.local-logs"
kubectl -n aegisvolt get deploy -l track=stable -o json 2>/dev/null \
  | jq '[.items[] | {key: .metadata.labels.app, value: {image: .spec.template.spec.containers[0].image,
          version: ((.spec.template.spec.containers[0].env // []) | map(select(.name=="SERVICE_VERSION")) | .[0].value // "")}}] | from_entries' \
  > "$SNAPSHOT" || echo '{}' > "$SNAPSHOT"
log "1/4 foto previa: $(jq -c 'with_entries(.value = (.value.image | split(":")[-1]))' "$SNAPSHOT")"

log "2/4 terraform apply (workspace $(terraform -chdir="$TF_DIR" workspace show))"
terraform -chdir="$TF_DIR" apply -auto-approve -input=false -no-color | grep -E "Apply complete|No changes|Error" || fail "terraform apply falló (la app no se tocó)"

log "3/4 despliegue canary"
if ! "$ROOT_DIR/scripts/deploy.sh" "$ENV" "$VERSION"; then
  log "✖ el canary falló: se revierte TODO el ambiente a la foto previa"
  "$ROOT_DIR/scripts/rollback.sh" "$ENV" "$SNAPSHOT"
  exit 1
fi

log "4/4 smoke test"
if ! "$ROOT_DIR/scripts/smoke-test.sh" "$ENV"; then
  log "✖ smoke test falló: rollback del ambiente"
  "$ROOT_DIR/scripts/rollback.sh" "$ENV" "$SNAPSHOT"
  exit 1
fi
log "═══ CD $ENV OK · $VERSION en producción del ambiente ═══"
