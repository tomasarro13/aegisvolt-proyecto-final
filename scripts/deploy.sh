#!/usr/bin/env bash
# Despliegue de un ambiente en su clúster EKS. La primera vez despliega directo;
# las siguientes usan Canary por servicio (scripts/canary-deploy.sh).
# Uso: scripts/deploy.sh <env> <version>
source "$(dirname "$0")/lib.sh"
ENV="${1:-}"; VERSION="${2:-}"
require_env "$ENV"; [ -n "$VERSION" ] || fail "Falta la versión"
tf_select "$ENV"
VPC_ID=$(tf_output vpc_id)
REGISTRY=$(tf_output ecr_repositories >/dev/null 2>&1; terraform -chdir="$TF_DIR" output -json ecr_repositories | jq -r '."graphql-gateway"' | sed 's#/aegisvolt-.*##')
export KUBECONFIG; KUBECONFIG=$(kubeconfig_for "$ENV")
log "ambiente=$ENV versión=$VERSION clúster=aegisvolt-$ENV"

"$ROOT_DIR/scripts/build-images.sh" "$ENV" "$VERSION"

# Manifiestos base + overlay del ambiente (ConfigMap por ambiente, réplicas, endpoint privado AWS).
if [ "$USE_FLOCI" = "true" ]; then
  FLOCI_IP=$(floci_vpc_ip "$VPC_ID"); [ -n "$FLOCI_IP" ] || fail "Floci no está conectado a la VPC $VPC_ID"
  log "endpoint privado AWS (Floci) en la VPC: $FLOCI_IP"
else
  FLOCI_IP="127.0.0.1"
fi
PREFECT_IP=127.0.0.1
if docker inspect aegisvolt-prefect >/dev/null 2>&1; then
  PREFECT_IP=$(attach_to_vpc aegisvolt-prefect "$VPC_ID"); PREFECT_IP=${PREFECT_IP:-127.0.0.1}
  log "Prefect accesible desde el clúster en $PREFECT_IP:4200"
else
  log "Prefect no está corriendo (docker compose up -d prefect): las SAGAs no se reflejarán en Prefect"
fi
RENDERED=$(kubectl kustomize "$ROOT_DIR/k8s/overlays/$ENV" | sed -e "s/FLOCI_IP/$FLOCI_IP/" -e "s/PREFECT_IP/$PREFECT_IP/")
# La imagen del Deployment stable solo la cambia el canary al promover: aquí se conserva la que
# esté corriendo (o, en el primer despliegue, se usa la nueva versión).
for svc in "${SERVICES[@]}"; do
  current=$(kubectl -n aegisvolt get deploy "$svc-stable" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)
  RENDERED=$(echo "$RENDERED" | sed "s#image: aegisvolt/$svc:latest#image: ${current:-$REGISTRY/aegisvolt-$ENV/$svc:$VERSION}#")
done
echo "$RENDERED" | kubectl apply -f - >/dev/null
if [ "$USE_FLOCI" = "true" ]; then
  kubectl -n aegisvolt create secret generic aegisvolt-aws \
    --from-literal=AWS_ACCESS_KEY_ID=test --from-literal=AWS_SECRET_ACCESS_KEY=test \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
fi

# Orden: primero los servicios internos, al final el gateway.
for svc in station-reservation-service billing-wallet-service energy-dispatch-service graphql-gateway; do
  "$ROOT_DIR/scripts/canary-deploy.sh" "$ENV" "$svc" "$REGISTRY/aegisvolt-$ENV/$svc:$VERSION" "$VERSION"
done
log "despliegue de $ENV completado. GraphQL: $(tf_output graphql_url)"
