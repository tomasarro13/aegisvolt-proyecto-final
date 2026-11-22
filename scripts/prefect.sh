#!/usr/bin/env bash
# Asegura el servidor Prefect (Docker, UI http://localhost:4200) y sirve los flujos de auditoría programados.
# Las SAGAs en vivo las reporta el orquestador directamente (no requiere este proceso).
source "$(dirname "$0")/lib.sh"
cd "$ROOT_DIR/observability/prefect"
mkdir -p "$ROOT_DIR/.local-logs"
[ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; }
export PREFECT_API_URL="${PREFECT_API_URL:-http://127.0.0.1:4200/api}"
if ! curl -sf "$PREFECT_API_URL/health" >/dev/null 2>&1; then
  # Servidor en Docker (docker-compose.yml): alcanzable también desde los pods de EKS vía la VPC.
  docker compose -f "$ROOT_DIR/docker-compose.yml" up -d prefect >/dev/null
  for i in $(seq 1 90); do curl -sf "$PREFECT_API_URL/health" >/dev/null && break; sleep 1; done
fi
log "Prefect UI: http://127.0.0.1:4200"
exec .venv/bin/python serve.py
