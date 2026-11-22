import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import {
  createDocumentClient, createHttpApp, createLogger, DynamoFeatureFlags, errorHandler, listen, loadBaseConfig, resourceName,
} from '@aegisvolt/shared';
import { ActivateChargerUseCase } from './application/activate-charger.use-case.js';
import { systemClock } from './application/ports.js';
import { SessionService } from './application/session-service.js';
import { FaultInjectingChargerGateway, SimulatedChargerGateway } from './infrastructure/charger-gateways.js';
import { DynamoDispatchRepository } from './infrastructure/dynamo-dispatch-repository.js';
import { dispatchRoutes } from './interfaces/http/routes.js';

const config = loadBaseConfig('energy-dispatch-service', 4003);
const table = process.env.DISPATCH_TABLE ?? resourceName('dispatch', config.environment);
const logger = createLogger(config);
const db = createDocumentClient(config);

const repository = new DynamoDispatchRepository(db, table);
const flags = new DynamoFeatureFlags(db, config.featureFlagsTable, config.environment, logger);
const charger = new FaultInjectingChargerGateway(new SimulatedChargerGateway(logger), flags, logger);
const sessions = new SessionService(repository, charger, systemClock, logger);

const app = createHttpApp(logger, [{ name: 'dynamodb', check: async () => { await db.send(new DescribeTableCommand({ TableName: table })); } }]);
app.use(dispatchRoutes({ activate: new ActivateChargerUseCase(repository, charger, systemClock, logger), sessions }));
app.use(errorHandler(logger));

// Registro periódico de telemetría de sesiones activas.
const interval = Number(process.env.TELEMETRY_INTERVAL_MS ?? 5000);
const timer = setInterval(() => {
  sessions.recordTelemetry().catch((err) => logger.warn('no se pudo registrar telemetría', { error: err }));
}, interval);
timer.unref();

listen(app, config.port, logger, async () => { clearInterval(timer); await logger.flush(); });
