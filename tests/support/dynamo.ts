import { CreateTableCommand, DeleteTableCommand, DynamoDBClient, waitUntilTableExists } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';

/** Tablas efímeras en Floci (o DynamoDB Local) para pruebas de integración. */
export const endpoint = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566';
const raw = new DynamoDBClient({ region: 'us-east-1', endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
export const doc = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } });

export async function createTable(prefix: string, hashKey: string, rangeKey?: string): Promise<string> {
  const name = `it-${prefix}-${randomUUID().slice(0, 8)}`;
  await raw.send(new CreateTableCommand({
    TableName: name,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [{ AttributeName: hashKey, AttributeType: 'S' }, ...(rangeKey ? [{ AttributeName: rangeKey, AttributeType: 'S' as const }] : [])],
    KeySchema: [{ AttributeName: hashKey, KeyType: 'HASH' }, ...(rangeKey ? [{ AttributeName: rangeKey, KeyType: 'RANGE' as const }] : [])],
  }));
  await waitUntilTableExists({ client: raw, maxWaitTime: 60, minDelay: 1 }, { TableName: name });
  return name;
}

export async function dropTable(name: string): Promise<void> {
  await raw.send(new DeleteTableCommand({ TableName: name })).catch(() => undefined);
}
