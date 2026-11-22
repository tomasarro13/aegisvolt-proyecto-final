#!/usr/bin/env bash
# Canary de UN servicio (demo rápida, ~1 min): build + push a ECR + canary-deploy.
# Uso: scripts/canary-one.sh <env> <servicio> [versión]
#      CANARY_CHAOS_ERROR_RATE=0.5 scripts/canary-one.sh dev billing-wallet-service   # fuerza ROLLBACK
source "$(dirname "$0")/lib.sh"
ENV="${1:-}"; SVC="${2:-}"; VERSION="${3:-demo-$(date +%m%d-%H%M%S)}"
require_env "$ENV"; [ -n "$SVC" ] || fail "Falta el servicio (${SERVICES[*]})"
tf_select "$ENV"
export KUBECONFIG; KUBECONFIG=$(kubeconfig_for "$ENV")
REGISTRY=$(terraform -chdir="$TF_DIR" output -json ecr_repositories | jq -r '."graphql-gateway"' | sed 's#/aegisvolt-.*##')
"$ROOT_DIR/scripts/build-images.sh" "$ENV" "$VERSION" "$SVC"
"$ROOT_DIR/scripts/canary-deploy.sh" "$ENV" "$SVC" "$REGISTRY/aegisvolt-$ENV/$SVC:$VERSION" "$VERSION"
