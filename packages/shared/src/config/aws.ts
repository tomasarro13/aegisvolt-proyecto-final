import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { BaseConfig } from './environment.js';

/** Fábrica única del cliente DynamoDB: apunta a Floci en local y a AWS real si no hay endpoint. */
export function createDocumentClient(config: Pick<BaseConfig, 'aws'>): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    region: config.aws.region,
    ...(config.aws.endpoint ? { endpoint: config.aws.endpoint } : {}),
  });
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
  });
}
