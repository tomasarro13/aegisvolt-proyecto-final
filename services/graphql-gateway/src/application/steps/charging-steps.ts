import type { SagaStep } from '../../domain/saga-step.js';
import type { ChargingSagaContext } from '../charging-saga-context.js';
import type { BillingPort, DispatchPort, StationPort } from '../ports.js';

type Ctx = ChargingSagaContext & { sagaId: string };

/** Paso 1: station-reservation-service -> conector RESERVED. Compensación: liberar (AVAILABLE). */
export class ReserveConnectorStep implements SagaStep<Ctx> {
  readonly name = 'RESERVE_CONNECTOR';
  readonly service = 'station-reservation-service';
  constructor(private readonly stations: StationPort) {}

  async execute(ctx: Readonly<Ctx>): Promise<Partial<Ctx>> {
    const r = await this.stations.reserve({ sagaId: ctx.sagaId, stationId: ctx.stationId, connectorId: ctx.connectorId, fleetId: ctx.fleetId, fastChargeBoost: ctx.fastChargeBoost });
    return { priorityBoost: r.priorityBoost, holdUntil: r.holdUntil };
  }

  async compensate(ctx: Readonly<Ctx>, reason: string): Promise<void> {
    await this.stations.release(ctx.sagaId, reason);
  }
}

/** Paso 2: billing-wallet-service -> débito del saldo estimado. Compensación: reembolso. */
export class ChargeWalletStep implements SagaStep<Ctx> {
  readonly name = 'CHARGE_WALLET';
  readonly service = 'billing-wallet-service';
  constructor(private readonly billing: BillingPort) {}

  async execute(ctx: Readonly<Ctx>): Promise<Partial<Ctx>> {
    const c = await this.billing.charge({ sagaId: ctx.sagaId, fleetId: ctx.fleetId, estimatedKwh: ctx.estimatedKwh, powerKw: ctx.powerKw, priorityBoost: ctx.priorityBoost ?? false });
    return { chargedAmount: c.amount, currency: c.currency, pricingStrategy: c.quote.strategy, surgeMultiplier: c.quote.surgeMultiplier };
  }

  async compensate(ctx: Readonly<Ctx>, reason: string): Promise<void> {
    await this.billing.refund(ctx.sagaId, reason);
  }
}

/** Paso 3: energy-dispatch-service -> activación física. Compensación: detener la sesión. */
export class ActivateChargerStep implements SagaStep<Ctx> {
  readonly name = 'ACTIVATE_CHARGER';
  readonly service = 'energy-dispatch-service';
  constructor(private readonly dispatch: DispatchPort) {}

  async execute(ctx: Readonly<Ctx>): Promise<Partial<Ctx>> {
    const s = await this.dispatch.activate({ sagaId: ctx.sagaId, stationId: ctx.stationId, connectorId: ctx.connectorId, fleetId: ctx.fleetId, powerKw: ctx.powerKw, targetKwh: ctx.estimatedKwh });
    return { sessionStartedAt: s.startedAt };
  }

  async compensate(ctx: Readonly<Ctx>): Promise<void> {
    try {
      await this.dispatch.stop(ctx.sagaId);
    } catch (err) {
      // Si la sesión nunca se creó no hay nada que detener (compensación idempotente).
      if ((err as { code?: string }).code !== 'NOT_FOUND') throw err;
    }
  }
}

/** Paso 4 (pivote): confirma el conector en CHARGING. A partir de aquí la SAGA no se revierte. */
export class ConfirmChargingStep implements SagaStep<Ctx> {
  readonly name = 'CONFIRM_CONNECTOR_CHARGING';
  readonly service = 'station-reservation-service';
  constructor(private readonly stations: StationPort) {}

  async execute(ctx: Readonly<Ctx>): Promise<Partial<Ctx>> {
    await this.stations.startCharging(ctx.sagaId);
    return {};
  }

  async compensate(): Promise<void> {
    // La liberación del conector la realiza la compensación del paso 1.
  }
}
