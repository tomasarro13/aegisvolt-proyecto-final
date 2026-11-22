import { NotFoundError, type Logger } from '@aegisvolt/shared';
import type { ChargerGateway } from '../domain/charger-gateway.js';
import type { ChargingSessionSnapshot } from '../domain/charging-session.js';
import type { DispatchRepository } from '../domain/repositories.js';
import { simulateSample, type TelemetrySample } from '../domain/telemetry.js';
import type { Clock } from './ports.js';

export class SessionService {
  constructor(
    private readonly repository: DispatchRepository,
    private readonly charger: ChargerGateway,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async get(sagaId: string): Promise<ChargingSessionSnapshot> {
    const s = await this.repository.findSession(sagaId);
    if (!s) throw new NotFoundError('ChargingSession', sagaId);
    return s.toSnapshot();
  }

  async list(limit = 25): Promise<ChargingSessionSnapshot[]> {
    return (await this.repository.listSessions(limit)).map((s) => s.toSnapshot());
  }

  telemetry(sagaId: string, limit = 60): Promise<TelemetrySample[]> {
    return this.repository.listTelemetry(sagaId, limit);
  }

  /** Detiene el flujo eléctrico. Idempotente. También sirve de compensación del paso 3. */
  async stop(sagaId: string): Promise<ChargingSessionSnapshot> {
    const session = await this.repository.findSession(sagaId);
    if (!session) throw new NotFoundError('ChargingSession', sagaId);
    if (session.stop(this.clock.now())) {
      await this.charger.deactivate(session.toSnapshot().connectorId);
      await this.repository.updateSession(session);
      this.logger.info('sesión de carga detenida', { sagaId });
    }
    return session.toSnapshot();
  }

  /** Registra una muestra de telemetría por cada sesión activa (invocado periódicamente). */
  async recordTelemetry(): Promise<number> {
    const active = await this.repository.listActiveSessions();
    const now = this.clock.now();
    for (const session of active) {
      const sample = simulateSample(session.toSnapshot(), now);
      session.recordDelivery(sample.deliveredKwh, now);
      await this.repository.appendTelemetry(sample);
      await this.repository.updateSession(session);
    }
    return active.length;
  }
}
