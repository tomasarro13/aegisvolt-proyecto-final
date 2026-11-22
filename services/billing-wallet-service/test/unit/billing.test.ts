import { InMemoryFeatureFlags, NoopLogger } from '@aegisvolt/shared';
import { describe, expect, it } from 'vitest';
import { ChargeWalletUseCase } from '../../src/application/charge-wallet.use-case.js';
import { PricingStrategyResolver } from '../../src/application/pricing-resolver.js';
import { RefundChargeUseCase } from '../../src/application/refund-charge.use-case.js';
import { Charge, type LedgerEvent } from '../../src/domain/charge.js';
import { baseRateFor, peakHoursPredicate, StandardPricing, SurgePricing } from '../../src/domain/pricing.js';
import type { BillingRepository, WalletChange } from '../../src/domain/repositories.js';
import { Wallet } from '../../src/domain/wallet.js';

class MemoryBillingRepo implements BillingRepository {
  wallets = new Map<string, ReturnType<Wallet['toSnapshot']>>();
  charges = new Map<string, ReturnType<Charge['toSnapshot']>>();
  ledger: LedgerEvent[] = [];
  async findWallet(id: string) { const w = this.wallets.get(id); return w ? Wallet.fromSnapshot(w) : undefined; }
  async listWallets() { return [...this.wallets.values()].map(Wallet.fromSnapshot); }
  async findCharge(id: string) { const c = this.charges.get(id); return c ? Charge.fromSnapshot(c) : undefined; }
  async listLedger() { return this.ledger; }
  async saveCharge(charge: Charge, isNew: boolean, change?: WalletChange) {
    if (isNew && this.charges.has(charge.toSnapshot().sagaId)) throw new Error('duplicate');
    this.charges.set(charge.toSnapshot().sagaId, charge.toSnapshot());
    if (change) await this.saveTopUp(change);
  }
  async saveTopUp(change: WalletChange) {
    this.wallets.set(change.wallet.fleetId, change.wallet.toSnapshot());
    this.ledger.push(change.event);
  }
}

const clock = { now: () => new Date('2026-11-21T15:00:00Z') };
const setup = (balance: number, flags = new InMemoryFeatureFlags()) => {
  const repo = new MemoryBillingRepo();
  repo.wallets.set('FLEET-1', { fleetId: 'FLEET-1', fleetName: 'Flota 1', balance, currency: 'COP', version: 1, updatedAt: '' });
  const pricing = new PricingStrategyResolver(flags, () => true);
  return {
    repo,
    charge: new ChargeWalletUseCase(repo, pricing, clock, new NoopLogger()),
    refund: new RefundChargeUseCase(repo, clock, new NoopLogger()),
  };
};
const cmd = { sagaId: 'saga-1', fleetId: 'FLEET-1', estimatedKwh: 20, powerKw: 60, priorityBoost: false };

describe('Pricing (Strategy)', () => {
  it('tarifa base según potencia', () => {
    expect(baseRateFor(22)).toBe(1100);
    expect(baseRateFor(60)).toBe(1450);
    expect(baseRateFor(180)).toBe(1800);
  });
  it('surge solo aplica en hora pico', () => {
    const input = { estimatedKwh: 10, powerKw: 60, priorityBoost: false, at: new Date() };
    expect(new StandardPricing().quote(input).total).toBe(14500);
    expect(new SurgePricing(() => true).quote(input).total).toBe(19575);
    expect(new SurgePricing(() => false).quote(input).total).toBe(14500);
  });
  it('boost aplica multiplicador 1.2', () => {
    expect(new StandardPricing().quote({ estimatedKwh: 10, powerKw: 22, priorityBoost: true, at: new Date() }).total).toBe(13200);
  });
  it('detecta horas pico en zona horaria de Bogotá', () => {
    const isPeak = peakHoursPredicate('7-9,17-21', 'America/Bogota');
    expect(isPeak(new Date('2026-11-21T23:00:00Z'))).toBe(true);  // 18:00 Bogotá
    expect(isPeak(new Date('2026-11-21T17:00:00Z'))).toBe(false); // 12:00 Bogotá
  });
  it('la flag ENABLE_DYNAMIC_SURGE_PRICING selecciona la estrategia', async () => {
    expect((await new PricingStrategyResolver(new InMemoryFeatureFlags({ ENABLE_DYNAMIC_SURGE_PRICING: true }), () => true).resolve()).name).toBe('DYNAMIC_SURGE');
    expect((await new PricingStrategyResolver(new InMemoryFeatureFlags(), () => true).resolve()).name).toBe('STANDARD');
  });
});

describe('ChargeWalletUseCase / RefundChargeUseCase', () => {
  it('debita el saldo y registra el evento CHARGE', async () => {
    const { charge, repo } = setup(100_000);
    const result = await charge.execute(cmd);
    expect(result.amount).toBe(29000);
    expect(repo.wallets.get('FLEET-1')?.balance).toBe(71000);
    expect(repo.ledger.at(-1)?.type).toBe('CHARGE');
  });

  it('es idempotente: el mismo sagaId no cobra dos veces', async () => {
    const { charge, repo } = setup(100_000);
    await charge.execute(cmd);
    await charge.execute(cmd);
    expect(repo.wallets.get('FLEET-1')?.balance).toBe(71000);
    expect(repo.ledger.filter((e) => e.type === 'CHARGE')).toHaveLength(1);
  });

  it('rechaza con INSUFFICIENT_FUNDS y no modifica el saldo', async () => {
    const { charge, repo } = setup(1000);
    await expect(charge.execute(cmd)).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect(repo.wallets.get('FLEET-1')?.balance).toBe(1000);
    expect(repo.charges.get('saga-1')?.status).toBe('REJECTED');
  });

  it('el reembolso devuelve el saldo exactamente una vez aunque se procese dos veces', async () => {
    const { charge, refund, repo } = setup(100_000);
    await charge.execute(cmd);
    const first = await refund.execute('saga-1', 'ACTIVATE_CHARGER:CHARGER_HARDWARE_FAULT');
    const second = await refund.execute('saga-1', 'ACTIVATE_CHARGER:CHARGER_HARDWARE_FAULT');
    expect(first.refunded).toBe(true);
    expect(second.refunded).toBe(false);
    expect(repo.wallets.get('FLEET-1')?.balance).toBe(100_000);
    expect(repo.ledger.filter((e) => e.type === 'REFUND')).toHaveLength(1);
  });

  it('reembolso sin cobro previo es un no-op seguro', async () => {
    const { refund } = setup(100_000);
    expect((await refund.execute('saga-x', 'r')).refunded).toBe(false);
  });
});
