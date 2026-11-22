import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import {
  createDocumentClient, createHttpApp, createLogger, DynamoFeatureFlags, errorHandler, listen, loadBaseConfig, resourceName,
} from '@aegisvolt/shared';
import { ChargingLifecycleUseCase } from './application/charging-lifecycle.use-case.js';
import { systemClock } from './application/ports.js';
import { ReleaseReservationUseCase } from './application/release-reservation.use-case.js';
import { ReserveConnectorUseCase } from './application/reserve-connector.use-case.js';
import { StationQueries } from './application/station-queries.js';
import { DynamoReservationRepository } from './infrastructure/dynamo-reservation-repository.js';
import { stationRoutes } from './interfaces/http/routes.js';

/** Composition root: único lugar donde se instancian implementaciones concretas (DIP). */
const config = loadBaseConfig('station-reservation-service', 4001);
const table = process.env.RESERVATIONS_TABLE ?? resourceName('reservations', config.environment);
const logger = createLogger(config);
const db = createDocumentClient(config);

const repository = new DynamoReservationRepository(db, table);
const flags = new DynamoFeatureFlags(db, config.featureFlagsTable, config.environment, logger);

const app = createHttpApp(logger, [{ name: 'dynamodb', check: async () => { await db.send(new DescribeTableCommand({ TableName: table })); } }]);
app.use(stationRoutes({
  reserve: new ReserveConnectorUseCase(repository, flags, systemClock, logger),
  release: new ReleaseReservationUseCase(repository, systemClock, logger),
  lifecycle: new ChargingLifecycleUseCase(repository, systemClock, logger),
  queries: new StationQueries(repository),
}));
app.use(errorHandler(logger));

listen(app, config.port, logger, () => logger.flush());
