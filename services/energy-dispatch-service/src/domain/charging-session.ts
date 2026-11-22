import { InvalidSessionStateError } from './errors.js';

export type SessionStatus = 'ACTIVE' | 'FAILED' | 'STOPPED';

export interface ChargingSessionSnapshot {
  sagaId: string;
  stationId: string;
  connectorId: string;
  fleetId: string;
  powerKw: number;
  targetKwh: number;
  deliveredKwh: number;
  status: SessionStatus;
  failureReason?: string;
  startedAt: string;
  stoppedAt?: string;
  updatedAt: string;
}

/** Sesión de transferencia de energía (SAGA paso 3). */
export class ChargingSession {
  private constructor(private state: ChargingSessionSnapshot) {}

  static start(props: Omit<ChargingSessionSnapshot, 'status' | 'deliveredKwh' | 'startedAt' | 'updatedAt'>, now: Date): ChargingSession {
    return new ChargingSession({ ...props, status: 'ACTIVE', deliveredKwh: 0, startedAt: now.toISOString(), updatedAt: now.toISOString() });
  }

  static failed(props: Omit<ChargingSessionSnapshot, 'status' | 'deliveredKwh' | 'startedAt' | 'updatedAt'>, reason: string, now: Date): ChargingSession {
    return new ChargingSession({ ...props, status: 'FAILED', failureReason: reason, deliveredKwh: 0, startedAt: now.toISOString(), stoppedAt: now.toISOString(), updatedAt: now.toISOString() });
  }

  static fromSnapshot(s: ChargingSessionSnapshot): ChargingSession { return new ChargingSession({ ...s }); }

  get sagaId(): string { return this.state.sagaId; }
  get status(): SessionStatus { return this.state.status; }
  get failureReason(): string | undefined { return this.state.failureReason; }

  /** Avanza la energía entregada (limitada al objetivo). */
  recordDelivery(deliveredKwh: number, now: Date): void {
    if (this.state.status !== 'ACTIVE') throw new InvalidSessionStateError(this.state.sagaId, this.state.status);
    this.state = { ...this.state, deliveredKwh: Math.min(deliveredKwh, this.state.targetKwh), updatedAt: now.toISOString() };
  }

  /** Idempotente: detener una sesión ya detenida no hace nada. */
  stop(now: Date): boolean {
    if (this.state.status !== 'ACTIVE') return false;
    this.state = { ...this.state, status: 'STOPPED', stoppedAt: now.toISOString(), updatedAt: now.toISOString() };
    return true;
  }

  toSnapshot(): ChargingSessionSnapshot { return { ...this.state }; }
}
