import { ConnectorUnavailableError, InvalidStateTransitionError } from './errors.js';

export const CONNECTOR_STATUSES = ['AVAILABLE', 'RESERVED', 'CHARGING', 'OUT_OF_SERVICE'] as const;
export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number];
export type ConnectorType = 'CCS2' | 'CHADEMO' | 'TYPE2';

export interface ConnectorSnapshot {
  stationId: string;
  connectorId: string;
  type: ConnectorType;
  powerKw: number;
  status: ConnectorStatus;
  reservedBy?: string;
  reservedUntil?: string;
  version: number;
  updatedAt: string;
}

/**
 * Entidad Connector (bahía de carga). Encapsula las transiciones válidas de estado:
 * AVAILABLE -> RESERVED -> CHARGING -> AVAILABLE, y RESERVED -> AVAILABLE (compensación).
 */
export class Connector {
  private constructor(private state: ConnectorSnapshot) {}

  static fromSnapshot(snapshot: ConnectorSnapshot): Connector {
    return new Connector({ ...snapshot });
  }

  get id(): string { return this.state.connectorId; }
  get stationId(): string { return this.state.stationId; }
  get status(): ConnectorStatus { return this.state.status; }
  get powerKw(): number { return this.state.powerKw; }
  get reservedBy(): string | undefined { return this.state.reservedBy; }
  get version(): number { return this.state.version; }

  /** Una reserva vencida (hold expirado) se considera disponible otra vez. */
  isAvailable(now: Date): boolean {
    if (this.state.status === 'AVAILABLE') return true;
    return this.state.status === 'RESERVED' && !!this.state.reservedUntil && new Date(this.state.reservedUntil) < now;
  }

  reserve(sagaId: string, holdUntil: Date, now: Date): void {
    if (!this.isAvailable(now)) {
      throw new ConnectorUnavailableError(this.state.connectorId, this.state.status);
    }
    this.apply({ status: 'RESERVED', reservedBy: sagaId, reservedUntil: holdUntil.toISOString() }, now);
  }

  /** Compensación: solo libera si la reserva pertenece a esa SAGA (no pisa reservas ajenas). */
  release(sagaId: string, now: Date): boolean {
    if (this.state.reservedBy !== sagaId) return false;
    this.apply({ status: 'AVAILABLE', reservedBy: undefined, reservedUntil: undefined }, now);
    return true;
  }

  startCharging(sagaId: string, now: Date): void {
    if (this.state.status !== 'RESERVED' || this.state.reservedBy !== sagaId) {
      throw new InvalidStateTransitionError('Connector', this.state.status, 'CHARGING');
    }
    this.apply({ status: 'CHARGING', reservedUntil: undefined }, now);
  }

  finishCharging(sagaId: string, now: Date): void {
    if (this.state.status !== 'CHARGING' || this.state.reservedBy !== sagaId) {
      throw new InvalidStateTransitionError('Connector', this.state.status, 'AVAILABLE');
    }
    this.apply({ status: 'AVAILABLE', reservedBy: undefined }, now);
  }

  toSnapshot(): ConnectorSnapshot { return { ...this.state }; }

  private apply(changes: Partial<ConnectorSnapshot>, now: Date): void {
    this.state = { ...this.state, ...changes, version: this.state.version + 1, updatedAt: now.toISOString() };
  }
}
