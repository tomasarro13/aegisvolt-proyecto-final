import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand, ScanCommand, TransactWriteCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ConflictError } from '@aegisvolt/shared';
import { randomUUID } from 'node:crypto';
import { Charge, type ChargeSnapshot, type LedgerEvent } from '../domain/charge.js';
import type { BillingRepository, WalletChange } from '../domain/repositories.js';
import { Wallet, type WalletSnapshot } from '../domain/wallet.js';

type TransactItems = NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']>;

/**
 * Single-table en aegisvolt-billing-<env>:
 *   PK=WALLET#<fleet>  SK=META                 -> saldo (con version)
 *   PK=WALLET#<fleet>  SK=LEDGER#<ts>#<id>     -> libro mayor (CHARGE / REFUND / TOP_UP)
 *   PK=CHARGE#<saga>   SK=META                 -> cobro de la SAGA (clave de idempotencia)
 */
export class DynamoBillingRepository implements BillingRepository {
  constructor(private readonly db: DynamoDBDocumentClient, private readonly table: string) {}

  async findWallet(fleetId: string): Promise<Wallet | undefined> {
    const res = await this.db.send(new GetCommand({ TableName: this.table, Key: { pk: `WALLET#${fleetId}`, sk: 'META' }, ConsistentRead: true }));
    return res.Item ? Wallet.fromSnapshot(toWallet(res.Item)) : undefined;
  }

  async listWallets(): Promise<Wallet[]> {
    const res = await this.db.send(new ScanCommand({
      TableName: this.table,
      FilterExpression: 'begins_with(pk, :p) AND sk = :meta',
      ExpressionAttributeValues: { ':p': 'WALLET#', ':meta': 'META' },
    }));
    return (res.Items ?? []).map((i) => Wallet.fromSnapshot(toWallet(i))).sort((a, b) => a.fleetId.localeCompare(b.fleetId));
  }

  async findCharge(sagaId: string): Promise<Charge | undefined> {
    const res = await this.db.send(new GetCommand({ TableName: this.table, Key: { pk: `CHARGE#${sagaId}`, sk: 'META' }, ConsistentRead: true }));
    return res.Item ? Charge.fromSnapshot(res.Item as unknown as ChargeSnapshot) : undefined;
  }

  async listLedger(fleetId: string, limit: number): Promise<LedgerEvent[]> {
    const res = await this.db.send(new QueryCommand({
      TableName: this.table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :l)',
      ExpressionAttributeValues: { ':pk': `WALLET#${fleetId}`, ':l': 'LEDGER#' },
      ScanIndexForward: false,
      Limit: limit,
    }));
    return (res.Items ?? []) as unknown as LedgerEvent[];
  }

  async saveCharge(charge: Charge, isNew: boolean, walletChange?: WalletChange): Promise<void> {
    const c = charge.toSnapshot();
    const items: TransactItems = [{
      Put: {
        TableName: this.table,
        Item: { pk: `CHARGE#${c.sagaId}`, sk: 'META', entityType: 'CHARGE', ...c },
        // Nuevo cobro: no puede existir otro para la misma SAGA. Reembolso: solo desde CHARGED.
        ConditionExpression: isNew ? 'attribute_not_exists(pk)' : '#s = :charged',
        ...(isNew ? {} : { ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':charged': 'CHARGED' } }),
      },
    }];
    if (walletChange) items.push(...this.walletItems(walletChange));
    await this.commit(items, c.sagaId);
  }

  async saveTopUp(change: WalletChange): Promise<void> {
    await this.commit(this.walletItems(change), change.wallet.fleetId);
  }

  private walletItems({ wallet, expectedVersion, event }: WalletChange): TransactItems {
    const w = wallet.toSnapshot();
    return [
      {
        Put: {
          TableName: this.table,
          Item: { pk: `WALLET#${w.fleetId}`, sk: 'META', entityType: 'WALLET', ...w },
          ConditionExpression: 'version = :v',
          ExpressionAttributeValues: { ':v': expectedVersion },
        },
      },
      {
        Put: {
          TableName: this.table,
          Item: { pk: `WALLET#${w.fleetId}`, sk: `LEDGER#${event.at}#${event.sagaId ?? randomUUID()}#${event.type}`, entityType: 'LEDGER', ...event },
        },
      },
    ];
  }

  private async commit(items: TransactItems, ref: string): Promise<void> {
    try {
      await this.db.send(new TransactWriteCommand({ TransactItems: items }));
    } catch (err) {
      if (err instanceof TransactionCanceledException || (err as Error).name === 'TransactionCanceledException') {
        throw new ConflictError('CONCURRENT_MODIFICATION', `Conflicto de concurrencia/idempotencia en ${ref}; reintente`, { ref });
      }
      throw err;
    }
  }
}

function toWallet(item: Record<string, unknown>): WalletSnapshot {
  return {
    fleetId: String(item.fleetId),
    fleetName: String(item.fleetName ?? item.fleetId),
    balance: Number(item.balance),
    currency: String(item.currency ?? 'COP'),
    version: Number(item.version ?? 0),
    updatedAt: String(item.updatedAt ?? ''),
  };
}
