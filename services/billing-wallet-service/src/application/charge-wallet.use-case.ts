import { NotFoundError, type Logger } from '@aegisvolt/shared';
import { Charge, type ChargeSnapshot } from '../domain/charge.js';
import { InsufficientFundsError } from '../domain/errors.js';
import type { BillingRepository } from '../domain/repositories.js';
import type { PricingStrategyResolver } from './pricing-resolver.js';
import type { Clock } from './ports.js';

export interface ChargeWalletCommand {
  sagaId: string;
  fleetId: string;
  estimatedKwh: number;
  powerKw: number;
  priorityBoost: boolean;
}

/** SAGA paso 2: descuenta el saldo estimado. Idempotente: un reintento devuelve el mismo cobro. */
export class ChargeWalletUseCase {
  constructor(
    private readonly repository: BillingRepository,
    private readonly pricing: PricingStrategyResolver,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: ChargeWalletCommand): Promise<ChargeSnapshot> {
    const existing = await this.repository.findCharge(cmd.sagaId);
    if (existing) {
      this.logger.info('cobro ya procesado (petición duplicada)', { sagaId: cmd.sagaId, status: existing.status });
      if (existing.status === 'REJECTED') {
        const current = await this.repository.findWallet(cmd.fleetId);
        throw new InsufficientFundsError(cmd.fleetId, existing.amount, current?.balance ?? 0);
      }
      return existing.toSnapshot();
    }

    const wallet = await this.repository.findWallet(cmd.fleetId);
    if (!wallet) throw new NotFoundError('Wallet', cmd.fleetId);

    const now = this.clock.now();
    const strategy = await this.pricing.resolve();
    const quote = strategy.quote({ estimatedKwh: cmd.estimatedKwh, powerKw: cmd.powerKw, priorityBoost: cmd.priorityBoost, at: now });

    if (!wallet.canAfford(quote.total)) {
      const rejected = Charge.rejected(cmd.sagaId, cmd.fleetId, quote, 'INSUFFICIENT_FUNDS', now);
      await this.repository.saveCharge(rejected, true);
      this.logger.warn('cobro rechazado por fondos insuficientes', { sagaId: cmd.sagaId, required: quote.total, available: wallet.balance });
      throw new InsufficientFundsError(cmd.fleetId, quote.total, wallet.balance);
    }

    const expectedVersion = wallet.version;
    wallet.debit(quote.total, now);
    const charge = Charge.charged(cmd.sagaId, cmd.fleetId, quote, now);
    await this.repository.saveCharge(charge, true, {
      wallet, expectedVersion,
      event: { fleetId: cmd.fleetId, sagaId: cmd.sagaId, type: 'CHARGE', amount: -quote.total, balanceAfter: wallet.balance, at: now.toISOString() },
    });
    this.logger.info('saldo debitado', { sagaId: cmd.sagaId, amount: quote.total, strategy: quote.strategy, surge: quote.surgeMultiplier });
    return charge.toSnapshot();
  }
}
