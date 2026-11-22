import type { Logger } from '@aegisvolt/shared';
import type { ChargeSnapshot } from '../domain/charge.js';
import type { BillingRepository } from '../domain/repositories.js';
import type { Clock } from './ports.js';

export interface RefundResult {
  sagaId: string;
  refunded: boolean;
  charge?: ChargeSnapshot;
}

/**
 * Transacción compensatoria del paso 2: reembolsa el saldo y registra el evento de reversión.
 * Idempotente: el estado CHARGED -> REFUNDED solo ocurre una vez (escritura condicional).
 */
export class RefundChargeUseCase {
  constructor(private readonly repository: BillingRepository, private readonly clock: Clock, private readonly logger: Logger) {}

  async execute(sagaId: string, reason: string): Promise<RefundResult> {
    const charge = await this.repository.findCharge(sagaId);
    if (!charge) {
      this.logger.warn('compensación de cobro sin cobro previo: nada que reembolsar', { sagaId });
      return { sagaId, refunded: false };
    }
    const now = this.clock.now();
    if (!charge.refund(reason, now)) {
      this.logger.info('reembolso duplicado o no aplicable ignorado (idempotencia)', { sagaId, status: charge.status });
      return { sagaId, refunded: false, charge: charge.toSnapshot() };
    }
    const wallet = await this.repository.findWallet(charge.fleetId);
    if (!wallet) throw new Error(`Wallet ${charge.fleetId} no encontrada durante el reembolso`);
    const expectedVersion = wallet.version;
    wallet.credit(charge.amount, now);
    await this.repository.saveCharge(charge, false, {
      wallet, expectedVersion,
      event: { fleetId: charge.fleetId, sagaId, type: 'REFUND', amount: charge.amount, balanceAfter: wallet.balance, reason, at: now.toISOString() },
    });
    this.logger.info('COMPENSACIÓN: saldo reembolsado', { sagaId, amount: charge.amount, reason });
    return { sagaId, refunded: true, charge: charge.toSnapshot() };
  }
}
