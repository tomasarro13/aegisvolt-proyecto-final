#!/usr/bin/env bash
# Utilidades comunes para los scripts de despliegue (Floci por defecto; USE_FLOCI=false => AWS real).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="$ROOT_DIR/infra/terraform"
USE_FLOCI="${USE_FLOCI:-true}"
export AWS_REGION="${AWS_REGION:-us-east-1}" AWS_DEFAULT_REGION="${AWS_REGION:-us-east-1}"
if [ "$USE_FLOCI" = "true" ]; then
  export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}" AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
  export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
fi
SERVICES=(graphql-gateway station-reservation-service billing-wallet-service energy-dispatch-service)

log() { printf '\033[1;36m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
fail() { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

require_env() {
  case "${1:-}" in dev|test|prod) ;; *) fail "Ambiente inválido '${1:-}'. Use dev|test|prod";; esac
}

service_port() {
  case "$1" in
    graphql-gateway) echo 4000;; station-reservation-service) echo 4001;;
    billing-wallet-service) echo 4002;; energy-dispatch-service) echo 4003;;
  esac
}

tf_output() { terraform -chdir="$TF_DIR" output -raw "$1"; }

tf_select() {
  # El workspace se fija con TF_WORKSPACE (por proceso) y no con `workspace select` (global de la
  # carpeta): así dos comandos sobre ambientes distintos nunca se pisan.
  local env="$1"
  export TF_WORKSPACE=default
  terraform -chdir="$TF_DIR" init -input=false -reconfigure -backend-config="backend/$([ "$USE_FLOCI" = true ] && echo floci || echo aws).hcl" >/dev/null
  if ! terraform -chdir="$TF_DIR" workspace list | grep -qE "^[* ] +$env\$"; then
    terraform -chdir="$TF_DIR" workspace new "$env" >/dev/null
  fi
  export TF_WORKSPACE="$env"
  [ "$(terraform -chdir="$TF_DIR" workspace show)" = "$env" ] || fail "No se pudo seleccionar el workspace $env"
}

# Kubeconfig del clúster EKS del ambiente: .kube/<env>.yaml
kubeconfig_for() {
  local env="$1" cluster="aegisvolt-$1" file="$ROOT_DIR/.kube/$1.yaml"
  mkdir -p "$ROOT_DIR/.kube"
  if [ "$USE_FLOCI" = "true" ]; then
    local port
    port=$(aws eks describe-cluster --name "$cluster" --query 'cluster.endpoint' --output text | sed -E 's#.*:([0-9]+)$#\1#')
    docker exec "floci-aws-eks-$cluster" cat /etc/rancher/k3s/k3s.yaml \
      | sed "s#https://127.0.0.1:6443#https://localhost:${port}#" > "$file"
  else
    aws eks update-kubeconfig --name "$cluster" --kubeconfig "$file" >/dev/null
  fi
  echo "$file"
}

# IP de Floci dentro de la red de la VPC del ambiente (equivalente al ENI del VPC Endpoint).
floci_vpc_ip() {
  local vpc="$1"
  docker inspect aegisvolt-floci --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}={{$v.IPAddress}} {{end}}' \
    | tr ' ' '\n' | grep -- "$vpc" | head -1 | cut -d= -f2
}

# Conecta un contenedor (Prefect) a la red Docker de la VPC y devuelve su IP en ella.
attach_to_vpc() {
  local container="$1" vpc="$2" net
  net=$(docker network ls --format '{{.Name}}' | grep -- "$vpc" | head -1)
  [ -n "$net" ] || return 0
  docker network connect "$net" "$container" >/dev/null 2>&1 || true
  docker inspect "$container" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}={{$v.IPAddress}} {{end}}' \
    | tr ' ' '\n' | grep -- "$vpc" | head -1 | cut -d= -f2
}
