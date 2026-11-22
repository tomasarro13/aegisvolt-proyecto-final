import { GetCommand, PutCommand, ScanCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { SagaSnapshot } from '../domain/saga.js';
import type { SagaRepository } from '../domain/saga-step.js';

/** Log de la SAGA en aegisvolt-sagas-<env> (PK=sagaId). Lo audita el flujo de Prefect. */
export class DynamoSagaRepository<C extends object> implements SagaRepository<C> {
  constructor(private readonly db: DynamoDBDocumentClient, private readonly table: string) {}

  async save(snapshot: SagaSnapshot<C>): Promise<void> {
    await this.db.send(new PutCommand({ TableName: this.table, Item: { ...snapshot, statusUpdatedAt: `${snapshot.status}#${snapshot.updatedAt}` } }));
  }

  async find(sagaId: string): Promise<SagaSnapshot<C> | undefined> {
    const res = await this.db.send(new GetCommand({ TableName: this.table, Key: { sagaId }, ConsistentRead: true }));
    return res.Item as SagaSnapshot<C> | undefined;
  }

  async list(limit: number): Promise<SagaSnapshot<C>[]> {
    const items: SagaSnapshot<C>[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(new ScanCommand({ TableName: this.table, ExclusiveStartKey }));
      items.push(...((res.Items ?? []) as SagaSnapshot<C>[]));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
}
