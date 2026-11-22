import { InvalidStateTransitionError } from './errors.js';

export type ReservationStatus = 'RESERVED' | 'CHARGING' | 'COMPLETED' | 'RELEASED';

export interface ReservationSnapshot {
  sagaId: string;
  stationId: string;
  connectorId: string;
  fleetId: string;
  status: ReservationStatus;
  priorityBoost: boolean;
  holdUntil: string;
  releaseReason?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Registro de reserva indexado por sagaId: es la clave de idempotencia del paso 1 de la SAGA
 * y de su compensación.
 */
export class Reservation {
  private constructor(private state: ReservationSnapshot) {}

  static create(props: Omit<ReservationSnapshot, 'status' | 'createdAt' | 'updatedAt'>, now: Date): Reservation {
    return new Reservation({ ...props, status: 'RESERVED', createdAt: now.toISOString(), updatedAt: now.toISOString() });
  }

  /**
   * "Tombstone": la compensación llegó antes (o sin) la reserva. Se registra RELEASED para que una
   * reserva tardía de esa misma SAGA sea rechazada (mensajes fuera de orden).
   */
  static tombstone(sagaId: string, reason: string, now: Date): Reservation {
    return new Reservation({
      sagaId, stationId: '-', connectorId: '-', fleetId: '-', status: 'RELEASED', priorityBoost: false,
      holdUntil: now.toISOString(), releaseReason: reason, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    });
  }

  static fromSnapshot(s: ReservationSnapshot): Reservation { return new Reservation({ ...s }); }

  get sagaId(): string { return this.state.sagaId; }
  get status(): ReservationStatus { return this.state.status; }
  get stationId(): string { return this.state.stationId; }
  get connectorId(): string { return this.state.connectorId; }
  get isActive(): boolean { return this.state.status === 'RESERVED' || this.state.status === 'CHARGING'; }

  release(reason: string, now: Date): void {
    if (this.state.status === 'COMPLETED') throw new InvalidStateTransitionError('Reservation', 'COMPLETED', 'RELEASED');
    this.state = { ...this.state, status: 'RELEASED', releaseReason: reason, updatedAt: now.toISOString() };
  }

  startCharging(now: Date): void {
    if (this.state.status !== 'RESERVED') throw new InvalidStateTransitionError('Reservation', this.state.status, 'CHARGING');
    this.state = { ...this.state, status: 'CHARGING', updatedAt: now.toISOString() };
  }

  complete(now: Date): void {
    if (this.state.status !== 'CHARGING') throw new InvalidStateTransitionError('Reservation', this.state.status, 'COMPLETED');
    this.state = { ...this.state, status: 'COMPLETED', updatedAt: now.toISOString() };
  }

  toSnapshot(): ReservationSnapshot { return { ...this.state }; }
}
