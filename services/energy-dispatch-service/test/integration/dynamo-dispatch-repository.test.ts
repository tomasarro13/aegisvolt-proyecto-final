import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTable, doc, dropTable } from '../../../../tests/support/dynamo.js';
import { ChargingSession } from '../../src/domain/charging-session.js';
import { simulateSample } from '../../src/domain/telemetry.js';
import { DynamoDispatchRepository } from '../../src/infrastructure/dynamo-dispatch-repository.js';

let table: string;
let repo: DynamoDispatchRepository;

beforeAll(async () => { table = await createTable('dispatch', 'pk', 'sk'); repo = new DynamoDispatchRepository(doc, table); });
afterAll(() => dropTable(table));

describe('DynamoDispatchRepository (DynamoDB real)', () => {
  const props = { sagaId: 'saga-1', stationId: 'S1', connectorId: 'C1', fleetId: 'F1', powerKw: 60, targetKwh: 20 };

  it('createSession es idempotente (escritura condicional)', async () => {
    expect(await repo.createSession(ChargingSession.start(props, new Date()))).toBe(true);
    expect(await repo.createSession(ChargingSession.start(props, new Date()))).toBe(false);
  });

  it('telemetría con bucket de 5 s: dos réplicas escribiendo la misma muestra no la duplican', async () => {
    const s = (await repo.findSession('saga-1'))!.toSnapshot();
    const sample = simulateSample(s, new Date());
    await repo.appendTelemetry(sample);
    await repo.appendTelemetry(sample);
    expect(await repo.listTelemetry('saga-1', 10)).toHaveLength(1);
    expect((await repo.listActiveSessions()).map((x) => x.sagaId)).toContain('saga-1');
  });
});
