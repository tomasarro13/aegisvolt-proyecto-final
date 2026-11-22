import type { PriceQuote } from './pricing.js';

export type ChargeStatus = 'CHARGED' | 'REFUNDED' | 'REJECTED';

export interface ChargeSnapshot {
  sagaId: string;
  fleetId: string;
  amount: number;
  currency: string;
  status: ChargeStatus;
  quote: PriceQuote;
  rejectionReason?: string;
  refundReason?: string;
  refundedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Cobro asociado a una SAGA. sagaId es la clave de idempotencia del paso 2 y de su compensación. */
export class Charge {
  private constructor(private state: ChargeSnapshot) {}

  static charged(sagaId: string, fleetId: string, quote: PriceQuote, now: Date): Charge {
    return new Charge({ sagaId, fleetId, amount: quote.total, currency: quote.currency, status: 'CHARGED', quote, createdAt: now.toISOString(), updatedAt: now.toISOString() });
  }

  static rejected(sagaId: string, fleetId: string, quote: PriceQuote, reason: string, now: Date): Charge {
    return new Charge({ sagaId, fleetId, amount: quote.total, currency: quote.currency, status: 'REJECTED', quote, rejectionReason: reason, createdAt: now.toISOString(), updatedAt: now.toISOString() });
  }

  static fromSnapshot(s: ChargeSnapshot): Charge { return new Charge({ ...s }); }

  get status(): ChargeStatus { return this.state.status; }
  get amount(): number { return this.state.amount; }
  get fleetId(): string { return this.state.fleetId; }

  /** Devuelve false si no hay nada que reembolsar (ya reembolsado o rechazado): idempotencia. */
  refund(reason: string, now: Date): boolean {
    if (this.state.status !== 'CHARGED') return false;
    this.state = { ...this.state, status: 'REFUNDED', refundReason: reason, refundedAt: now.toISOString(), updatedAt: now.toISOString() };
    return true;
  }

  toSnapshot(): ChargeSnapshot { return { ...this.state }; }
}

export type LedgerEventType = 'CHARGE' | 'REFUND' | 'TOP_UP';

export interface LedgerEvent {
  fleetId: string;
  sagaId?: string;
  type: LedgerEventType;
  amount: number;
  balanceAfter: number;
  reason?: string;
  at: string;
}
