import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand, ScanCommand, TransactWriteCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Connector, type ConnectorSnapshot } from '../domain/connector.js';
import { ConnectorUnavailableError } from '../domain/errors.js';
import { Reservation, type ReservationSnapshot } from '../domain/reservation.js';
import type { ReservationRepository, StationQueryRepository } from '../domain/repositories.js';
import type { StationInfo, StationView } from '../domain/station.js';

/**
 * Diseño single-table en aegisvolt-reservations-<env>:
 *   PK=STATION#<id>      SK=META               -> datos de la estación
 *   PK=STATION#<id>      SK=CONNECTOR#<id>     -> estado del conector (con version)
 *   PK=RESERVATION#<saga> SK=META              -> reserva / clave de idempotencia
 */
export class DynamoReservationRepository implements ReservationRepository, StationQueryRepository {
  constructor(private readonly db: DynamoDBDocumentClient, private readonly table: string) {}

  async findConnector(stationId: string, connectorId: string): Promise<Connector | undefined> {
    const res = await this.db.send(new GetCommand({
      TableName: this.table,
      Key: { pk: `STATION#${stationId}`, sk: `CONNECTOR#${connectorId}` },
      ConsistentRead: true,
    }));
    return res.Item ? Connector.fromSnapshot(toConnector(res.Item)) : undefined;
  }

  async findReservation(sagaId: string): Promise<Reservation | undefined> {
    const res = await this.db.send(new GetCommand({
      TableName: this.table,
      Key: { pk: `RESERVATION#${sagaId}`, sk: 'META' },
      ConsistentRead: true,
    }));
    return res.Item ? Reservation.fromSnapshot(res.Item as unknown as ReservationSnapshot) : undefined;
  }

  async save(reservation: Reservation, connector?: { entity: Connector; expectedVersion: number }): Promise<void> {
    const r = reservation.toSnapshot();
    const items: NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']> = [{
      Put: { TableName: this.table, Item: { pk: `RESERVATION#${r.sagaId}`, sk: 'META', entityType: 'RESERVATION', ...r } },
    }];
    if (connector) {
      const c = connector.entity.toSnapshot();
      items.push({
        Put: {
          TableName: this.table,
          Item: { pk: `STATION#${c.stationId}`, sk: `CONNECTOR#${c.connectorId}`, entityType: 'CONNECTOR', ...c },
          // Control de concurrencia optimista: dos SAGAs no pueden reservar el mismo conector.
          ConditionExpression: 'version = :expected',
          ExpressionAttributeValues: { ':expected': connector.expectedVersion },
        },
      });
    }
    try {
      await this.db.send(new TransactWriteCommand({ TransactItems: items }));
    } catch (err) {
      if (err instanceof TransactionCanceledException || (err as Error).name === 'TransactionCanceledException') {
        throw new ConnectorUnavailableError(connector?.entity.id ?? '?', 'CONCURRENT_MODIFICATION');
      }
      throw err;
    }
  }

  async listStations(city?: string): Promise<StationView[]> {
    const items: Record<string, unknown>[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(new ScanCommand({
        TableName: this.table,
        FilterExpression: 'begins_with(pk, :p)',
        ExpressionAttributeValues: { ':p': 'STATION#' },
        ExclusiveStartKey,
      }));
      items.push(...(res.Items ?? []));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    const stations = groupStations(items);
    return city ? stations.filter((s) => s.city.toLowerCase() === city.toLowerCase()) : stations;
  }

  async getStation(stationId: string): Promise<StationView | undefined> {
    const res = await this.db.send(new QueryCommand({
      TableName: this.table,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `STATION#${stationId}` },
    }));
    return groupStations(res.Items ?? [])[0];
  }
}

function toConnector(item: Record<string, unknown>): ConnectorSnapshot {
  return {
    stationId: String(item.stationId),
    connectorId: String(item.connectorId),
    type: item.type as ConnectorSnapshot['type'],
    powerKw: Number(item.powerKw),
    status: item.status as ConnectorSnapshot['status'],
    reservedBy: item.reservedBy as string | undefined,
    reservedUntil: item.reservedUntil as string | undefined,
    version: Number(item.version ?? 0),
    updatedAt: String(item.updatedAt ?? ''),
  };
}

function groupStations(items: Record<string, unknown>[]): StationView[] {
  const stations = new Map<string, StationView>();
  const connectors: ConnectorSnapshot[] = [];
  for (const item of items) {
    if (item.sk === 'META') {
      const info = item as unknown as StationInfo;
      stations.set(info.stationId, {
        stationId: info.stationId, name: info.name, city: info.city, address: info.address,
        latitude: Number(info.latitude), longitude: Number(info.longitude), connectors: [],
      });
    } else if (String(item.sk).startsWith('CONNECTOR#')) {
      connectors.push(toConnector(item));
    }
  }
  for (const c of connectors) stations.get(c.stationId)?.connectors.push(c);
  for (const s of stations.values()) s.connectors.sort((a, b) => a.connectorId.localeCompare(b.connectorId));
  return [...stations.values()].sort((a, b) => a.stationId.localeCompare(b.stationId));
}
