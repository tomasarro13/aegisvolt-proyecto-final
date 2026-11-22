#!/usr/bin/env bash
# Data source "external": devuelve la IP privada del nodo EKS (contenedor k3s de Floci)
# dentro de la red Docker que Floci crea para la VPC. Entrada/salida en JSON (protocolo de Terraform).
set -euo pipefail
eval "$(jq -r '@sh "CLUSTER=\(.cluster) VPC=\(.vpc_id)"')"
CONTAINER="floci-aws-eks-${CLUSTER}"
IP=""
for i in $(seq 1 30); do
  IP=$(docker inspect "$CONTAINER" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}={{$v.IPAddress}} {{end}}' 2>/dev/null \
        | tr ' ' '\n' | grep -- "$VPC" | head -1 | cut -d= -f2 || true)
  [ -n "$IP" ] && break
  sleep 2
done
jq -n --arg ip "${IP:-127.0.0.1}" --arg container "$CONTAINER" '{ip: $ip, container: $container}'
