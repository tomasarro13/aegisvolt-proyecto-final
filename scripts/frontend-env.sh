#!/usr/bin/env bash
# Escribe las URLs GraphQL (API Gateway) de cada workspace en frontend/.env.local y observability/prefect/.env
source "$(dirname "$0")/lib.sh"
OUT_FE="$ROOT_DIR/frontend/.env.local"
OUT_PF="$ROOT_DIR/observability/prefect/.env"
LINES=""
for env in dev test prod; do
  if url=$(TF_WORKSPACE="$env" terraform -chdir="$TF_DIR" output -raw graphql_url 2>/dev/null); then
    upper=$(echo "$env" | tr '[:lower:]' '[:upper:]')
    LINES="${LINES}GRAPHQL_URL_${upper}=${url}"$'\n'
  fi
done
# Next.js expande "$var" dentro de .env: se escapa el stage "$default" del API Gateway.
printf '%sDEFAULT_ENVIRONMENT=dev\n' "${LINES//\$default/\\\$default}" > "$OUT_FE"
printf '%sAWS_ENDPOINT_URL=%s\nAWS_REGION=%s\n' "$LINES" "${AWS_ENDPOINT_URL:-http://localhost:4566}" "$AWS_REGION" > "$OUT_PF"
log "URLs por ambiente:"
cat "$OUT_FE"
