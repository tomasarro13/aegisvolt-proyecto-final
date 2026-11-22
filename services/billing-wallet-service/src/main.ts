import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import {
  createDocumentClient, createHttpApp, createLogger, DynamoFeatureFlags, errorHandler, listen, loadBaseConfig, resourceName,
} from '@aegisvolt/shared';
import { ChargeWalletUseCase } from './application/charge-wallet.use-case.js';
import { systemClock } from './application/ports.js';
import { PricingStrategyResolver } from './application/pricing-resolver.js';
import { RefundChargeUseCase } from './application/refund-charge.use-case.js';
import { WalletService } from './application/wallet-queries.js';
import { peakHoursPredicate } from './domain/pricing.js';
import { DynamoBillingRepository } from './infrastructure/dynamo-billing-repository.js';
import { billingRoutes } from './interfaces/http/routes.js';

const config = loadBaseConfig('billing-wallet-service', 4002);
const table = process.env.BILLING_TABLE ?? resourceName('billing', config.environment);
const logger = createLogger(config);
const db = createDocumentClient(config);

const repository = new DynamoBillingRepository(db, table);
const flags = new DynamoFeatureFlags(db, config.featureFlagsTable, config.environment, logger);
const pricing = new PricingStrategyResolver(
  flags,
  peakHoursPredicate(process.env.SURGE_PEAK_HOURS ?? '7-9,17-21', process.env.SURGE_TIMEZONE ?? 'America/Bogota'),
);

const app = createHttpApp(logger, [{ name: 'dynamodb', check: async () => { await db.send(new DescribeTableCommand({ TableName: table })); } }]);
app.use(billingRoutes({
  charge: new ChargeWalletUseCase(repository, pricing, systemClock, logger),
  refund: new RefundChargeUseCase(repository, systemClock, logger),
  wallets: new WalletService(repository, pricing, systemClock, logger),
}));
app.use(errorHandler(logger));

listen(app, config.port, logger, () => logger.flush());
