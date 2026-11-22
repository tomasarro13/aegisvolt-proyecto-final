# =============================================================================
# AegisVolt — comandos del proyecto y de la demostración.   make help
# Variables: ENV=dev|test|prod  SVC=<microservicio>  VERSION=<tag>  SAGA=<saga-id>
# =============================================================================
ENV ?= dev
SVC ?= billing-wallet-service
VERSION ?= $(shell git rev-parse --short=12 HEAD 2>/dev/null || date +%Y%m%d-%H%M%S)
TF := terraform -chdir=infra/terraform
# Workspace por proceso: no cambia el workspace "seleccionado" de la carpeta
TFE := TF_WORKSPACE=$(ENV) terraform -chdir=infra/terraform
AWS := AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 AWS_ENDPOINT_URL=http://localhost:4566 aws
KC := KUBECONFIG=.kube/$(ENV).yaml kubectl -n aegisvolt

.PHONY: help up down bootstrap infra plan deploy cd rollback smoke canary canary-fail cd-fail \
        frontend frontend-env prefect status pods watch logs trace flags flag-on flag-off \
        tfstate-versions tf-workspaces drift test lint integration e2e ci-local

help: ## Lista de comandos
	@grep -hE '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------- plataforma
up: ## Levanta Floci (AWS) y Prefect en Docker
	docker compose up -d floci prefect

down: ## Detiene Floci y Prefect (el estado persiste en volúmenes)
	docker compose down

bootstrap: up ## (una vez) Bucket S3 versionado para tfstate + tabla de locks
	cd infra/terraform/bootstrap && terraform init -input=false && terraform apply -auto-approve

tf-init:
	@TF_WORKSPACE=default $(TF) init -input=false -backend-config=backend/floci.hcl >/dev/null
	@TF_WORKSPACE=default $(TF) workspace list | grep -qE "^[* ] +$(ENV)$$" || TF_WORKSPACE=default $(TF) workspace new $(ENV)

infra: tf-init ## terraform apply del workspace ENV
	$(TFE) apply -auto-approve

plan: tf-init ## terraform plan del workspace ENV (qué cambiaría)
	$(TFE) plan

tf-workspaces: ## Workspaces y llaves de estado en S3
	$(TF) workspace list
	$(AWS) s3 ls s3://aegisvolt-tfstate --recursive

tfstate-versions: ## Historial (versiones) del tfstate del workspace ENV en S3
	$(AWS) s3api list-object-versions --bucket aegisvolt-tfstate --prefix "env:/$(ENV)/" \
	  --query 'Versions[].[VersionId,LastModified,Size,IsLatest]' --output table

drift: ## Detecta cambios hechos fuera de Terraform (exit 2 = hay drift)
	$(TFE) plan -refresh-only -detailed-exitcode

# ---------------------------------------------------------------- despliegue
deploy: ## Build + ECR + canary de los 4 servicios en ENV
	./scripts/deploy.sh $(ENV) $(VERSION)

cd: ## Pipeline CD completo en ENV (apply + canary + smoke + rollback si falla)
	./scripts/cd.sh $(ENV) $(VERSION)

smoke: ## Smoke test del ambiente ENV vía API Gateway
	./scripts/smoke-test.sh $(ENV)

rollback: ## Rollback manual del ambiente ENV a la revisión anterior
	./scripts/rollback.sh $(ENV)

canary: ## Canary exitoso de SVC en ENV (~1 min)
	ANALYSIS_SECONDS=20 ./scripts/canary-one.sh $(ENV) $(SVC)

canary-fail: ## Canary con 50% de errores en SVC => ROLLBACK automático
	CANARY_CHAOS_ERROR_RATE=0.5 ANALYSIS_SECONDS=20 ./scripts/canary-one.sh $(ENV) $(SVC)

cd-fail: ## CD completo donde falla el canary de SVC => rollback de TODO el ambiente
	CANARY_CHAOS_ERROR_RATE=0.5 CANARY_CHAOS_SERVICE=$(SVC) ANALYSIS_SECONDS=15 ./scripts/cd.sh $(ENV) demo-fail-$(shell date +%H%M%S)

# ---------------------------------------------------------------- operación / evidencias
frontend-env: ## Genera las URLs GraphQL de cada ambiente para el frontend y Prefect
	./scripts/frontend-env.sh

frontend: ## Frontend en modo desarrollo (http://localhost:3100)
	npm run dev -w frontend

prefect: ## Servidor Prefect + flujos de auditoría programados
	./scripts/prefect.sh

status: ## Resumen del ambiente ENV: versiones desplegadas, pods, URL
	@echo "Ambiente $(ENV) · GraphQL: $$($(TFE) output -raw graphql_url 2>/dev/null)"
	@$(KC) get deploy -o custom-columns='DEPLOYMENT:.metadata.name,READY:.status.readyReplicas,IMAGEN:.spec.template.spec.containers[0].image' | sed 's#000000000000.dkr.ecr.us-east-1.localhost:4566/##'

pods: ## Pods del clúster EKS de ENV
	$(KC) get pods -o wide -L track

watch: ## Pods en vivo (útil durante el canary)
	$(KC) get pods -L track -w

logs: ## Logs en vivo de SVC en ENV desde CloudWatch
	$(AWS) logs tail /aegisvolt/$(ENV)/$(SVC) --follow --since 5m

trace: ## Traza completa de una SAGA en CloudWatch: make trace ENV=dev SAGA=saga-...
	@for s in graphql-gateway station-reservation-service billing-wallet-service energy-dispatch-service; do \
	  $(AWS) logs filter-log-events --log-group-name /aegisvolt/$(ENV)/$$s --filter-pattern '"$(SAGA)"' --query 'events[].message' --output json; \
	done | jq -rs 'add | map(fromjson) | sort_by(.timestamp) | .[] | "\(.timestamp[11:23])  \(.service | .[0:28] | . + (" " * (28 - length)))  \(.level | ascii_upcase | .[0:5])  \(.message) \(.step // .error_code // "")"'

canary-log: ## Decisiones de canary/rollback registradas en CloudWatch para ENV
	@$(AWS) logs filter-log-events --log-group-name /aegisvolt/$(ENV)/canary --query 'events[].message' --output json \
	  | jq -r '.[] | fromjson | "\(.message)  \(.service // "") \(.version // "")  \(.decision // "")  \(.analysis // "" | tostring)"'

flags: ## Estado de las feature flags de ENV (tabla DynamoDB)
	@$(AWS) dynamodb scan --table-name aegisvolt-feature-flags-$(ENV) --query 'Items[].[flagKey.S,enabled.BOOL,updatedBy.S]' --output table

flag-on: ## Enciende una flag por CLI: make flag-on ENV=test KEY=SIMULATE_CHARGER_HARDWARE_FAULT
	$(AWS) dynamodb update-item --table-name aegisvolt-feature-flags-$(ENV) --key '{"flagKey":{"S":"$(KEY)"}}' \
	  --update-expression 'SET enabled = :v, updatedBy = :u' --expression-attribute-values '{":v":{"BOOL":true},":u":{"S":"cli"}}'

flag-off: ## Apaga una flag por CLI
	$(AWS) dynamodb update-item --table-name aegisvolt-feature-flags-$(ENV) --key '{"flagKey":{"S":"$(KEY)"}}' \
	  --update-expression 'SET enabled = :v, updatedBy = :u' --expression-attribute-values '{":v":{"BOOL":false},":u":{"S":"cli"}}'

# ---------------------------------------------------------------- pruebas
test: ## Pruebas unitarias
	npm run test:unit

lint: ## ESLint (incluye reglas de Clean Architecture)
	npm run lint

integration: ## Pruebas de integración contra DynamoDB de Floci
	npm run test:integration

e2e: ## E2E: frontend -> API Gateway -> EKS -> DynamoDB del ambiente ENV
	E2E_ENVIRONMENT=$(ENV) E2E_GRAPHQL_URL="$$($(TFE) output -raw graphql_url)" npm run test:e2e

ci-local: ## Ensayo local de los checks del CI (lint, build, schema, unit, integration, tf validate/plan)
	npm run lint && npm run build && npm run graphql:validate
	npm run test:unit && npm run test:integration
	cd observability/prefect && .venv/bin/python -m pytest -q tests
	$(TF) fmt -check -recursive && $(TF) validate
	$(TFE) plan -input=false -no-color | grep -E "^Plan:|No changes"
