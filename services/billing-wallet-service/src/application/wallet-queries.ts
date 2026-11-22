import { NotFoundError, ValidationError, type Logger } from '@aegisvolt/shared';
import type { LedgerEvent } from '../domain/charge.js';
import type { BillingRepository } from '../domain/repositories.js';
import type { WalletSnapshot } from '../domain/wallet.js';
import type { PricingStrategyResolver } from './pricing-resolver.js';
import type { Clock } from './ports.js';

export interface WalletView extends WalletSnapshot {
  ledger: LedgerEvent[];
}

export class WalletService {
  constructor(
    private readonly repository: BillingRepository,
    private readonly pricing: PricingStrategyResolver,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async list(): Promise<WalletSnapshot[]> {
    return (await this.repository.listWallets()).map((w) => w.toSnapshot());
  }

  async get(fleetId: string): Promise<WalletView> {
    const wallet = await this.repository.findWallet(fleetId);
    if (!wallet) throw new NotFoundError('Wallet', fleetId);
    return { ...wallet.toSnapshot(), ledger: await this.repository.listLedger(fleetId, 25) };
  }

  async charge(sagaId: string) {
    const charge = await this.repository.findCharge(sagaId);
    if (!charge) throw new NotFoundError('Charge', sagaId);
    return charge.toSnapshot();
  }

  async quote(estimatedKwh: number, powerKw: number, priorityBoost: boolean) {
    return (await this.pricing.resolve()).quote({ estimatedKwh, powerKw, priorityBoost, at: this.clock.now() });
  }

  async topUp(fleetId: string, amount: number): Promise<WalletSnapshot> {
    if (!(amount > 0)) throw new ValidationError('El monto de recarga debe ser positivo');
    const wallet = await this.repository.findWallet(fleetId);
    if (!wallet) throw new NotFoundError('Wallet', fleetId);
    const now = this.clock.now();
    const expectedVersion = wallet.version;
    wallet.credit(amount, now);
    await this.repository.saveTopUp({ wallet, expectedVersion, event: { fleetId, type: 'TOP_UP', amount, balanceAfter: wallet.balance, at: now.toISOString() } });
    this.logger.info('billetera recargada', { fleetId, amount });
    return wallet.toSnapshot();
  }
}
