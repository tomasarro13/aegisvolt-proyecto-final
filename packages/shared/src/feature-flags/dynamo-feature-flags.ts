import { GetCommand, PutCommand, ScanCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Logger } from '../logging/logger.js';
import { FLAG_KEYS, isFlagKey, type FeatureFlag, type FeatureFlagAdmin, type FlagKey } from './feature-flags.js';

interface CacheEntry { value: boolean; expiresAt: number }

/**
 * Feature flags propias sobre DynamoDB (aegisvolt-feature-flags-<env>).
 * El TTL de caché corto (2 s por defecto) permite cambiar una flag en caliente sin redesplegar.
 * Si DynamoDB falla se usa el último valor conocido y, sin él, `false` (fail-safe).
 */
export class DynamoFeatureFlags implements FeatureFlagAdmin {
  private readonly cache = new Map<FlagKey, CacheEntry>();

  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly environment: string,
    private readonly logger: Logger,
    private readonly ttlMs = 2000,
  ) {}

  async isEnabled(key: FlagKey): Promise<boolean> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    try {
      const res = await this.db.send(new GetCommand({ TableName: this.tableName, Key: { flagKey: key } }));
      const value = res.Item?.enabled === true;
      this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
      return value;
    } catch (err) {
      this.logger.warn('feature flag no disponible, usando valor por defecto', { flag: key, error: err });
      return cached?.value ?? false;
    }
  }

  async list(): Promise<FeatureFlag[]> {
    const res = await this.db.send(new ScanCommand({ TableName: this.tableName }));
    const byKey = new Map((res.Items ?? []).filter((i) => isFlagKey(String(i.flagKey))).map((i) => [i.flagKey as FlagKey, i]));
    return FLAG_KEYS.map((key) => {
      const item = byKey.get(key);
      return {
        key,
        enabled: item?.enabled === true,
        description: String(item?.description ?? ''),
        environment: this.environment,
        updatedAt: String(item?.updatedAt ?? ''),
        updatedBy: item?.updatedBy ? String(item.updatedBy) : undefined,
      };
    });
  }

  async set(key: FlagKey, enabled: boolean, updatedBy: string): Promise<FeatureFlag> {
    const current = (await this.list()).find((f) => f.key === key);
    const flag: FeatureFlag = {
      key,
      enabled,
      description: current?.description ?? key,
      environment: this.environment,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };
    await this.db.send(new PutCommand({
      TableName: this.tableName,
      Item: { flagKey: key, enabled, description: flag.description, environment: this.environment, updatedAt: flag.updatedAt, updatedBy },
    }));
    this.cache.delete(key);
    this.logger.info('feature flag actualizada', { flag: key, enabled, updatedBy });
    return flag;
  }
}
