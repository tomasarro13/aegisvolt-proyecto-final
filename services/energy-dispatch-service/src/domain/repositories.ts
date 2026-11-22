import type { ChargingSession } from './charging-session.js';
import type { TelemetrySample } from './telemetry.js';

export interface DispatchRepository {
  findSession(sagaId: string): Promise<ChargingSession | undefined>;
  listSessions(limit: number): Promise<ChargingSession[]>;
  listActiveSessions(): Promise<ChargingSession[]>;
  /** Crea la sesión solo si no existe (idempotencia por sagaId). Devuelve false si ya existía. */
  createSession(session: ChargingSession): Promise<boolean>;
  updateSession(session: ChargingSession): Promise<void>;
  appendTelemetry(sample: TelemetrySample): Promise<void>;
  listTelemetry(sagaId: string, limit: number): Promise<TelemetrySample[]>;
}
