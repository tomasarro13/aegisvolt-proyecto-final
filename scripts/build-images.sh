#!/usr/bin/env bash
# Construye las imágenes Docker y las publica en el ECR del ambiente.
# Uso: scripts/build-images.sh <env> <version> [servicio...]
source "$(dirname "$0")/lib.sh"
ENV="${1:-}"; VERSION="${2:-}"; shift 2 || true
require_env "$ENV"; [ -n "$VERSION" ] || fail "Falta la versión (p. ej. git SHA)"
TARGETS=("$@"); [ ${#TARGETS[@]} -gt 0 ] || TARGETS=("${SERVICES[@]}")
REGISTRY=$(aws ecr describe-repositories --query "repositories[?repositoryName=='aegisvolt-$ENV/graphql-gateway'].repositoryUri" --output text | sed 's#/aegisvolt-.*##')
[ -n "$REGISTRY" ] || fail "No existe ECR para $ENV (¿terraform apply?)"
if [ "$USE_FLOCI" != "true" ]; then
  aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"
fi
for svc in "${TARGETS[@]}"; do
  image="$REGISTRY/aegisvolt-$ENV/$svc:$VERSION"
  if docker manifest inspect "$image" >/dev/null 2>&1 || aws ecr describe-images --repository-name "aegisvolt-$ENV/$svc" --image-ids imageTag="$VERSION" >/dev/null 2>&1; then
    log "$image ya existe (tags inmutables), se reutiliza"; continue
  fi
  log "build $svc -> $image"
  docker build -q --build-arg SERVICE="$svc" --build-arg VERSION="$VERSION" -t "$image" "$ROOT_DIR" >/dev/null
  for attempt in 1 2 3 4; do
    docker push -q "$image" >/dev/null && break
    [ "$attempt" = 4 ] && fail "no se pudo publicar $image"
    log "reintentando push ($attempt)…"; sleep $((attempt * 3))
  done
done
log "imágenes publicadas en $REGISTRY"
