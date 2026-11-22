import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { createDocumentClient, createLogger, DynamoFeatureFlags, HttpClient, loadBaseConfig, resourceName } from '@aegisvolt/shared';
import { randomUUID } from 'node:crypto';
import type { ChargingSagaContext } from './application/charging-saga-context.js';
import { DashboardQueries, FeatureFlagAdminUseCase } from './application/dashboard-queries.js';
import { StartChargingSagaUseCase } from './application/start-charging-saga.use-case.js';
import { ActivateChargerStep, ChargeWalletStep, ConfirmChargingStep, ReserveConnectorStep } from './application/steps/charging-steps.js';
import { StopChargingSessionUseCase } from './application/stop-charging-session.use-case.js';
import { DynamoSagaRepository } from './infrastructure/dynamo-saga-repository.js';
import { BillingHttpAdapter, DispatchHttpAdapter, HttpHealthCheck, StationHttpAdapter } from './infrastructure/http-adapters.js';
import { createGatewayServer } from './interfaces/graphql/server.js';
import { PrefectSagaObserver } from './infrastructure/prefect-saga-observer.js';

/** Composition root del gateway GraphQL + orquestador SAGA. */
const config = loadBaseConfig('graphql-gateway', 4000);
const logger = createLogger(config);
const db = createDocumentClient(config);
const clock = { now: () => new Date() };

const urls = {
  station: process.env.STATION_SERVICE_URL ?? 'http://localhost:4001',
  billing: process.env.BILLING_SERVICE_URL ?? 'http://localhost:4002',
  dispatch: process.env.DISPATCH_SERVICE_URL ?? 'http://localhost:4003',
};
const stations = new StationHttpAdapter(new HttpClient('station-reservation-service', { baseUrl: urls.station }));
const billing = new BillingHttpAdapter(new HttpClient('billing-wallet-service', { baseUrl: urls.billing }));
const dispatch = new DispatchHttpAdapter(new HttpClient('energy-dispatch-service', { baseUrl: urls.dispatch }));

type Ctx = ChargingSagaContext & { sagaId: string };
const sagaTable = process.env.SAGAS_TABLE ?? resourceName('sagas', config.environment);
const sagas = new DynamoSagaRepository<Ctx>(db, sagaTable);
const flags = new DynamoFeatureFlags(db, config.featureFlagsTable, config.environment, logger);
const flagMutationsAllowed = (process.env.ALLOW_FLAG_MUTATIONS ?? String(config.environment !== 'prod')) === 'true';

// Observabilidad de cada SAGA en Prefect (flow run por SAGA, task run por paso/compensación).
const prefectApi = process.env.PREFECT_API_URL;
const sagaObserver = prefectApi
  ? new PrefectSagaObserver(prefectApi, process.env.PREFECT_UI_URL ?? 'http://localhost:4200', config.environment, logger)
  : undefined;

const startSaga = new StartChargingSagaUseCase(
  stations,
  [new ReserveConnectorStep(stations), new ChargeWalletStep(billing), new ActivateChargerStep(dispatch), new ConfirmChargingStep(stations)],
  sagas,
  { next: () => `saga-${randomUUID()}` },
  clock,
  logger,
  config.environment,
  sagaObserver,
);

const server = createGatewayServer({
  queries: new DashboardQueries(stations, billing, dispatch, sagas, [
    new HttpHealthCheck('station-reservation-service', urls.station),
    new HttpHealthCheck('billing-wallet-service', urls.billing),
    new HttpHealthCheck('energy-dispatch-service', urls.dispatch),
  ]),
  flags: new FeatureFlagAdminUseCase(flags, flagMutationsAllowed, logger),
  startSaga,
  stopSession: new StopChargingSessionUseCase(sagas, dispatch, stations, clock, logger),
  environment: { name: config.environment, version: config.serviceVersion, track: config.deploymentTrack, region: config.aws.region, flagMutationsAllowed },
}, logger, async () => {
  try { await db.send(new DescribeTableCommand({ TableName: sagaTable })); return true; } catch { return false; }
});

server.listen(config.port, () => logger.info('graphql-gateway iniciado', { port: config.port, urls }));
const shutdown = () => server.close(() => { void logger.flush().finally(() => process.exit(0)); });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
