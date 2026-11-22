import type { Charge, LedgerEvent } from './charge.js';
import type { Wallet } from './wallet.js';

export interface WalletChange {
  wallet: Wallet;
  expectedVersion: number;
  event: LedgerEvent;
}

/** Persistencia atómica: cobro + saldo + evento de libro mayor en una sola transacción. */
export interface BillingRepository {
  findWallet(fleetId: string): Promise<Wallet | undefined>;
  listWallets(): Promise<Wallet[]>;
  findCharge(sagaId: string): Promise<Charge | undefined>;
  listLedger(fleetId: string, limit: number): Promise<LedgerEvent[]>;
  /** Si `isNew` el cobro no debe existir previamente (attribute_not_exists) -> idempotencia fuerte. */
  saveCharge(charge: Charge, isNew: boolean, walletChange?: WalletChange): Promise<void>;
  saveTopUp(change: WalletChange): Promise<void>;
}
