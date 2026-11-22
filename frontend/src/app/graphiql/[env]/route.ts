import { resolveGraphqlUrl } from '@/infrastructure/environments';

export const dynamic = 'force-dynamic';

const GRAPHIQL_VERSION = '4.5.2';

/** Operaciones de ejemplo precargadas en el explorador (se ejecutan con el botón ▶ eligiendo la operación). */
const DEFAULT_QUERY = `# Explorador GraphQL de AegisVolt
# Las peticiones van: navegador -> BFF Next.js -> API Gateway del ambiente -> graphql-gateway (EKS).
# Use el botón "Docs" (izquierda) para recorrer el esquema y Ctrl+Espacio para autocompletar.
# Seleccione una operación con el botón ▶ (o ponga el cursor dentro y pulse Ctrl+Enter).

query Ambiente {
  environment { name version track region flagMutationsAllowed }
  systemHealth { service status latencyMs }
}

query Estaciones {
  stations {
    id name city availableConnectors
    connectors { id type powerKw status reservedBy }
  }
}

query FeatureFlags {
  featureFlags { key enabled description updatedBy updatedAt }
}

query Cotizacion {
  priceQuote(estimatedKwh: 25, powerKw: 60, fastChargeBoost: false) {
    total currency strategy surgeMultiplier boostMultiplier baseRatePerKwh
  }
}

query HistorialSagas {
  sagas(limit: 10) {
    id status fleetId connectorId chargedAmount compensated prefectRunUrl
    failure { step code message }
    steps { name service status attempts errorCode }
  }
}

query Billeteras {
  wallets { fleetId fleetName balance currency }
  wallet(fleetId: "FLEET-CONDOR") { balance ledger { type amount balanceAfter reason sagaId at } }
}

# --- Mutations -------------------------------------------------------------

# Inicia la SAGA: reserva -> cobro -> activación física -> confirmación
mutation ReservarYActivar {
  reserveAndActivateCharging(input: {
    fleetId: "FLEET-ANDES", stationId: "BOG-01", connectorId: "BOG-01-C3", estimatedKwh: 20
  }) {
    id status chargedAmount pricingStrategy prefectRunUrl
    failure { step code message }
    steps { name service status }
  }
}

# Fondos insuficientes (paso 2 falla => se libera el conector)
mutation SagaSinFondos {
  reserveAndActivateCharging(input: {
    fleetId: "FLEET-COLIBRI", stationId: "MDE-01", connectorId: "MDE-01-C1", estimatedKwh: 80
  }) { id status failure { step code } steps { name status } prefectRunUrl }
}

# Inyección de falla de hardware (paso 3 falla => reembolso + liberación)
mutation ActivarFallaHardware {
  setFeatureFlag(key: SIMULATE_CHARGER_HARDWARE_FAULT, enabled: true) { key enabled environment }
}

mutation DesactivarFallaHardware {
  setFeatureFlag(key: SIMULATE_CHARGER_HARDWARE_FAULT, enabled: false) { key enabled environment }
}
`;

export async function GET(_req: Request, ctx: { params: Promise<{ env: string }> }) {
  const { env } = await ctx.params;
  if (!resolveGraphqlUrl(env)) {
    return new Response(`Ambiente "${env}" no configurado (GRAPHQL_URL_${env.toUpperCase()})`, { status: 404 });
  }
  const config = { endpoint: `/api/graphql/${env}`, title: `AegisVolt GraphQL · ${env}`, defaultQuery: DEFAULT_QUERY };
  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AegisVolt GraphQL · ${env}</title>
  <link rel="icon" href="/icon.svg" />
  <link rel="stylesheet" href="https://unpkg.com/@graphql-yoga/graphiql@${GRAPHIQL_VERSION}/dist/graphiql.css" />
  <style>
    html, body, #root { height: 100%; margin: 0; }
    .aegis-bar { position: fixed; top: 0; left: 0; right: 0; z-index: 10; display: flex; gap: 12px; align-items: center;
      padding: 6px 14px; background: #07090c; color: #e9eef2; font: 13px/1.4 ui-monospace, monospace; border-bottom: 1px solid #1f2731; }
    .aegis-bar a { color: #c9fd34; text-decoration: none; }
    .aegis-bar .env { padding: 1px 8px; border-radius: 6px; background: ${env === 'prod' ? '#f87171' : env === 'test' ? '#fbbf24' : '#60a5fa'}; color: #07090c; font-weight: 600; text-transform: uppercase; }
    #root { padding-top: 34px; box-sizing: border-box; }
  </style>
</head>
<body>
  <div class="aegis-bar">
    <span>⚡ AegisVolt GraphQL</span><span class="env">${env}</span>
    <span>endpoint: /api/graphql/${env} → API Gateway (${env})</span>
    <span style="margin-left:auto">${['dev', 'test', 'prod'].filter((e) => e !== env && resolveGraphqlUrl(e)).map((e) => `<a href="/graphiql/${e}">${e}</a>`).join(' · ')} · <a href="/?env=${env}">← dashboard</a></span>
  </div>
  <div id="root"></div>
  <script src="https://unpkg.com/@graphql-yoga/graphiql@${GRAPHIQL_VERSION}/dist/yoga-graphiql.umd.js"></script>
  <script>
    // Workers del editor Monaco (mismo arranque que usa GraphQL Yoga)
    function prepareBlob(r){const o=new Blob([r],{type:"application/javascript"});return URL.createObjectURL(o)}const workers={},workerUrls={editorWorkerService:"https://unpkg.com/@graphql-yoga/graphiql@${GRAPHIQL_VERSION}/dist/monacoeditorwork/editor.worker.bundle.js",json:"https://unpkg.com/@graphql-yoga/graphiql@${GRAPHIQL_VERSION}/dist/monacoeditorwork/json.worker.bundle.js",graphql:"https://unpkg.com/@graphql-yoga/graphiql@${GRAPHIQL_VERSION}/dist/monacoeditorwork/graphql.worker..bundle.js"};function prepareWorkers(){return Promise.all(Object.entries(workerUrls).map(async([r,o])=>{const e=await fetch(o),t=await e.text();workers[r]=prepareBlob(t)}))}self.MonacoEnvironment={globalAPI:!1,getWorkerUrl:function(r,o){return workers[o]}}
    prepareWorkers().finally(() => YogaGraphiQL.renderYogaGraphiQL(document.getElementById('root'), ${JSON.stringify(config)}));
  </script>
</body>
</html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
