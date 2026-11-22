import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTable, doc, dropTable } from '../../../../tests/support/dynamo.js';
import { Reservation } from '../../src/domain/reservation.js';
import { DynamoReservationRepository } from '../../src/infrastructure/dynamo-reservation-repository.js';

let table: string;
let repo: DynamoReservationRepository;
const now = new Date();

beforeAll(async () => {
  table = await createTable('reservations', 'pk', 'sk');
  repo = new DynamoReservationRepository(doc, table);
  await doc.send(new PutCommand({ TableName: table, Item: { pk: 'STATION#S1', sk: 'META', stationId: 'S1', name: 'Test', city: 'Bogotá', address: 'x', latitude: 4.6, longitude: -74 } }));
  await doc.send(new PutCommand({ TableName: table, Item: { pk: 'STATION#S1', sk: 'CONNECTOR#C1', stationId: 'S1', connectorId: 'C1', type: 'CCS2', powerKw: 60, status: 'AVAILABLE', version: 1, updatedAt: '' } }));
});
afterAll(() => dropTable(table));

describe('DynamoReservationRepository (DynamoDB real)', () => {
  it('lista estaciones con sus conectores', async () => {
    const [station] = await repo.listStations();
    expect(station).toMatchObject({ stationId: 'S1', connectors: [{ connectorId: 'C1', status: 'AVAILABLE' }] });
  });

  it('guarda reserva + conector atómicamente (TransactWriteItems)', async () => {
    const connector = (await repo.findConnector('S1', 'C1'))!;
    const v = connector.version;
    connector.reserve('saga-a', new Date(now.getTime() + 60_000), now);
    await repo.save(Reservation.create({ sagaId: 'saga-a', stationId: 'S1', connectorId: 'C1', fleetId: 'F', priorityBoost: false, holdUntil: now.toISOString() }, now), { entity: connector, expectedVersion: v });
    expect((await repo.findConnector('S1', 'C1'))!.status).toBe('RESERVED');
    expect((await repo.findReservation('saga-a'))!.status).toBe('RESERVED');
  });

  it('control de concurrencia optimista: una versión obsoleta es rechazada', async () => {
    const stale = (await repo.findConnector('S1', 'C1'))!;
    const fresh = (await repo.findConnector('S1', 'C1'))!;
    fresh.release('saga-a', now);
    await repo.save(Reservation.tombstone('saga-x', 'r', now), { entity: fresh, expectedVersion: stale.version });
    stale.release('saga-a', now);
    await expect(repo.save(Reservation.tombstone('saga-y', 'r', now), { entity: stale, expectedVersion: stale.version - 1 }))
      .rejects.toMatchObject({ code: 'CONNECTOR_UNAVAILABLE' });
  });
});
