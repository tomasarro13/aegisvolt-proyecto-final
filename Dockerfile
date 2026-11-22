# syntax=docker/dockerfile:1.7
# Imagen genérica para los 4 servicios backend (ARG SERVICE). Multi-stage: compila en
# "build" y copia solo dist/ + dependencias de producción en una imagen mínima no-root.
ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS build
ARG SERVICE
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
# Todos los package.json de los workspaces (npm ci valida el lockfile completo del monorepo).
COPY packages/shared/package.json packages/shared/
COPY services/graphql-gateway/package.json services/graphql-gateway/
COPY services/station-reservation-service/package.json services/station-reservation-service/
COPY services/billing-wallet-service/package.json services/billing-wallet-service/
COPY services/energy-dispatch-service/package.json services/energy-dispatch-service/
COPY frontend/package.json frontend/
RUN npm ci --workspace packages/shared --workspace services/${SERVICE} --include-workspace-root --ignore-scripts
COPY packages/shared packages/shared
COPY services/${SERVICE} services/${SERVICE}
RUN npm run build -w packages/shared && npm run build -w services/${SERVICE}

FROM node:${NODE_VERSION} AS deps
ARG SERVICE
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/services services-manifests
COPY --from=build /app/frontend/package.json frontend/
RUN mkdir -p services && for d in services-manifests/*; do mkdir -p services/$(basename $d) && cp $d/package.json services/$(basename $d)/; done && rm -rf services-manifests
RUN npm ci --omit=dev --workspace packages/shared --workspace services/${SERVICE} --ignore-scripts

FROM node:${NODE_VERSION} AS runtime
ARG SERVICE
ARG VERSION=local
ENV NODE_ENV=production SERVICE_VERSION=${VERSION}
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/services/${SERVICE}/package.json services/${SERVICE}/
COPY --from=build /app/services/${SERVICE}/dist services/${SERVICE}/dist
WORKDIR /app/services/${SERVICE}
USER node
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-4000}/health/live || exit 1
CMD ["node", "dist/main.js"]
