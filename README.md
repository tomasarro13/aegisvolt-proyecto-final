# AegisVolt ⚡

Plataforma cloud-native para que operadores de flotas eléctricas reserven bahías de carga, paguen
desde una billetera y activen sesiones de carga. La transacción distribuida usa el **patrón SAGA**
con compensaciones, y hay **3 ambientes estáticos aislados** (dev, test, prod) sobre AWS emulado
con **[Floci](https://github.com/floci-io/floci)**, sin costo.

```
 Navegador ── Next.js + HyperMotion (BFF /api/graphql/<env>)
                   │ HTTPS
                   ▼
        API Gateway HTTP (por ambiente) ── VPC Link (ENIs en subredes privadas)
                   │  http://<ip-privada-nodo-EKS>:30080
                   ▼
 ┌──────────────── EKS aegisvolt-<env> (k3s en Floci) ─────────────────┐
 │  graphql-gateway  (GraphQL Yoga + Orquestador SAGA)                  │
 │      ├── station-reservation-service ── aegisvolt-reservations-<env> │
 │      ├── billing-wallet-service ─────── aegisvolt-billing-<env>      │
 │      └── energy-dispatch-service ────── aegisvolt-dispatch-<env>     │
 │      (log de SAGA: aegisvolt-sagas-<env> · flags: aegisvolt-feature-flags-<env>)
 └───────────── tráfico a AWS por VPC Endpoints (S3, DynamoDB, Logs…) ──┘
          CloudWatch Logs /aegisvolt/<env>/<svc>  ◄── Prefect (salud + auditoría SAGA)
```

## Estructura del monorepo

Es un solo repositorio con **4 microservicios independientes**. Cada uno tiene su propio
`package.json`, imagen Docker, Deployment en Kubernetes y tabla DynamoDB. Se comunican solo por HTTP.

| Ruta | Contenido |
|---|---|
| `services/station-reservation-service` | Disponibilidad y bloqueo temporal de conectores (paso 1 + compensación) |
| `services/billing-wallet-service` | Cobro, reembolso y libro mayor; precios por Strategy (paso 2 + compensación) |
| `services/energy-dispatch-service` | Activación del cargador, inyección de fallas y telemetría (paso 3) |
| `services/graphql-gateway` | Esquema GraphQL unificado y **orquestador SAGA** genérico |
| `packages/shared` | Solo cuestiones técnicas transversales: logger JSON→CloudWatch, feature flags y cliente HTTP |
| `frontend` | Next.js 16 + [HyperMotion](https://www.hypermotion.tech/) (globo 3D, text loop, menú flotante, fluid sim) + GSAP |
| `infra/terraform` | Bootstrap del backend S3 y módulos `network`, `dynamodb`, `feature_flags`, `observability`, `ecr`, `eks`, `api_gateway` |
| `k8s` | Kustomize: `base` + `overlays/{dev,test,prod}` + plantilla `canary` |
| `observability/prefect` | Flujos de salud y auditoría de consistencia SAGA |
| `.github/workflows` | `ci.yml` (pre-merge) y `cd.yml` (post-merge con canary) |

## Requisitos

Docker Desktop, Node 22+, Terraform ≥ 1.10, AWS CLI v2, kubectl, jq y Python 3.10+.
Las credenciales de AWS son ficticias (`test/test`): todo corre en Floci.

## Puesta en marcha (primera vez)

```bash
npm install && npm run build
make bootstrap                    # Floci + bucket S3 versionado aegisvolt-tfstate + tabla de locks
make infra ENV=dev                # terraform workspace dev -> VPC, VPCE, DynamoDB, EKS, API GW, logs, ECR
make deploy ENV=dev               # build, push a ECR y despliegue en EKS (canary desde la 2.ª versión)
make frontend-env && make frontend   # http://localhost:3100  (selector dev/test/prod)
make prefect                      # http://localhost:4200 · flow "saga-reservar-y-activar-carga": cada SAGA en vivo
```

Para `test` y `prod` se repite con `ENV=test` / `ENV=prod`. Cada ambiente tiene su propio
workspace, su VPC (10.10/10.20/10.30), su clúster EKS, sus tablas y su API Gateway.

## Pruebas

| Comando | Qué valida |
|---|---|
| `npm run test:unit` | Dominio y casos de uso: SAGA, compensaciones, idempotencia, precios y flags |
| `npm run test:integration` | Repositorios contra DynamoDB real de Floci (escrituras condicionales y transacciones) y el endpoint GraphQL |
| `make e2e ENV=dev` | Frontend BFF → API Gateway → GraphQL → microservicios → DynamoDB (feliz, fondos insuficientes, falla de hardware, idempotencia) |
| `observability/prefect`: `pytest` | Reglas de auditoría de consistencia |

## Flujo Git

`feature/*` → PR → `dev` → PR → `test` → PR → `prod`. El ruleset bloquea el force push y el push
directo, y exige 6 checks en verde. Se configura con `scripts/github/setup-branch-protection.sh <owner>/<repo>`.

