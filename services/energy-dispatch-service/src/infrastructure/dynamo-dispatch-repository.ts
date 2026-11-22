import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, QueryCommand, ScanCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ChargingSession, type ChargingSessionSnapshot } from '../domain/charging-session.js';
import type { DispatchRepository } from '../domain/repositories.js';
import type { TelemetrySample } from '../domain/telemetry.js';

const TELEMETRY_BUCKET_MS = 5000;

/**
 * Single-table en aegisvolt-dispatch-<env>:
 *   PK=SESSION#<saga>  SK=META                  -> sesión de carga
 *   PK=SESSION#<saga>  SK=TELEMETRY#<bucket>    -> muestra (bucket de 5 s: varias réplicas no duplican)
 */
export class DynamoDispatchRepository implements DispatchRepository {
  constructor(private readonly db: DynamoDBDocumentClient, private readonly table: string) {}

  async findSession(sagaId: string): Promise<ChargingSession | undefined> {
    const res = await this.db.send(new GetCommand({ TableName: this.table, Key: { pk: `SESSION#${sagaId}`, sk: 'META' }, ConsistentRead: true }));
    return res.Item ? ChargingSession.fromSnapshot(res.Item as unknown as ChargingSessionSnapshot) : undefined;
  }

  async listSessions(limit: number): Promise<ChargingSession[]> {
    return (await this.scanSessions()).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit).map(ChargingSession.fromSnapshot);
  }

  async listActiveSessions(): Promise<ChargingSession[]> {
    return (await this.scanSessions()).filter((s) => s.status === 'ACTIVE').map(ChargingSession.fromSnapshot);
  }

  async createSession(session: ChargingSession): Promise<boolean> {
    const s = session.toSnapshot();
    try {
      await this.db.send(new PutCommand({
        TableName: this.table,
        Item: { pk: `SESSION#${s.sagaId}`, sk: 'META', entityType: 'SESSION', ...s },
        ConditionExpression: 'attribute_not_exists(pk)',
      }));
      return true;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException || (err as Error).name === 'ConditionalCheckFailedException') return false;
      throw err;
    }
  }

  async updateSession(session: ChargingSession): Promise<void> {
    const s = session.toSnapshot();
    await this.db.send(new PutCommand({ TableName: this.table, Item: { pk: `SESSION#${s.sagaId}`, sk: 'META', entityType: 'SESSION', ...s } }));
  }

  async appendTelemetry(sample: TelemetrySample): Promise<void> {
    const bucket = Math.floor(Date.parse(sample.at) / TELEMETRY_BUCKET_MS) * TELEMETRY_BUCKET_MS;
    await this.db.send(new PutCommand({
      TableName: this.table,
      Item: { pk: `SESSION#${sample.sagaId}`, sk: `TELEMETRY#${new Date(bucket).toISOString()}`, entityType: 'TELEMETRY', ...sample },
    }));
  }

  async listTelemetry(sagaId: string, limit: number): Promise<TelemetrySample[]> {
    const res = await this.db.send(new QueryCommand({
      TableName: this.table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :t)',
      ExpressionAttributeValues: { ':pk': `SESSION#${sagaId}`, ':t': 'TELEMETRY#' },
      ScanIndexForward: false,
      Limit: limit,
    }));
    return ((res.Items ?? []) as unknown as TelemetrySample[]).reverse();
  }

  private async scanSessions(): Promise<ChargingSessionSnapshot[]> {
    const items: ChargingSessionSnapshot[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(new ScanCommand({
        TableName: this.table,
        FilterExpression: 'sk = :meta',
        ExpressionAttributeValues: { ':meta': 'META' },
        ExclusiveStartKey,
      }));
      items.push(...((res.Items ?? []) as unknown as ChargingSessionSnapshot[]));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }
}
