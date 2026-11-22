import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { InMemoryFeatureFlags, NoopLogger } from '@aegisvolt/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTable, doc, dropTable } from '../../../../tests/support/dynamo.js';
import { ChargeWalletUseCase } from '../../src/application/charge-wallet.use-case.js';
import { PricingStrategyResolver } from '../../src/application/pricing-resolver.js';
import { RefundChargeUseCase } from '../../src/application/refund-charge.use-case.js';
import { Charge } from '../../src/domain/charge.js';
import { DynamoBillingRepository } from '../../src/infrastructure/dynamo-billing-repository.js';

let table: string;
let repo: DynamoBillingRepository;
const clock = { now: () => new Date() };

beforeAll(async () => {
  table = await createTable('billing', 'pk', 'sk');
  repo = new DynamoBillingRepository(doc, table);
  await doc.send(new PutCommand({ TableName: table, Item: { pk: 'WALLET#F1', sk: 'META', fleetId: 'F1', fleetName: 'Flota', balance: 100000, currency: 'COP', version: 1, updatedAt: '' } }));
});
afterAll(() => dropTable(table));

describe('DynamoBillingRepository (DynamoDB real)', () => {
  const pricing = new PricingStrategyResolver(new InMemoryFeatureFlags(), () => false);

  it('cobro y reembolso actualizan saldo y libro mayor', async () => {
    const charge = new ChargeWalletUseCase(repo, pricing, clock, new NoopLogger());
    const refund = new RefundChargeUseCase(repo, clock, new NoopLogger());
    const c = await charge.execute({ sagaId: 'saga-1', fleetId: 'F1', estimatedKwh: 10, powerKw: 60, priorityBoost: false });
    expect((await repo.findWallet('F1'))!.balance).toBe(100000 - c.amount);
    await refund.execute('saga-1', 'test');
    expect((await repo.findWallet('F1'))!.balance).toBe(100000);
    const ledger = await repo.listLedger('F1', 10);
    expect(ledger.map((e) => e.type).sort()).toEqual(['CHARGE', 'REFUND']);
  });

  it('attribute_not_exists impide un segundo cobro con el mismo sagaId a nivel de base de datos', async () => {
    const existing = (await repo.findCharge('saga-1'))!;
    await expect(repo.saveCharge(Charge.fromSnapshot(existing.toSnapshot()), true)).rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION' });
  });

  it('el reembolso condicional (status = CHARGED) no puede aplicarse dos veces', async () => {
    const refunded = (await repo.findCharge('saga-1'))!;
    expect(refunded.status).toBe('REFUNDED');
    await expect(repo.saveCharge(refunded, false)).rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION' });
  });
});

