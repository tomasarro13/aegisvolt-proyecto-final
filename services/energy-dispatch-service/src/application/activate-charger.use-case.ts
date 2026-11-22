import type { Logger } from '@aegisvolt/shared';
import type { ChargerGateway } from '../domain/charger-gateway.js';
import { ChargingSession, type ChargingSessionSnapshot } from '../domain/charging-session.js';
import { ChargerHardwareFaultError } from '../domain/errors.js';
import type { DispatchRepository } from '../domain/repositories.js';
import type { Clock } from './ports.js';

export interface ActivateChargerCommand {
  sagaId: string;
  stationId: string;
  connectorId: string;
  fleetId: string;
  powerKw: number;
  targetKwh: number;
}

/**
 * SAGA paso 3: orden de activación física del cargador. Si el hardware falla se persiste la sesión
 * FAILED y se propaga el error para que el orquestador dispare las compensaciones.
 * Idempotente: un reintento con el mismo sagaId devuelve el mismo resultado (éxito o falla).
 */
export class ActivateChargerUseCase {
  constructor(
    private readonly repository: DispatchRepository,
    private readonly charger: ChargerGateway,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: ActivateChargerCommand): Promise<ChargingSessionSnapshot> {
    const existing = await this.repository.findSession(cmd.sagaId);
    if (existing) {
      this.logger.info('activación ya procesada (petición duplicada)', { sagaId: cmd.sagaId, status: existing.status });
      if (existing.status === 'FAILED') throw new ChargerHardwareFaultError(cmd.connectorId, existing.failureReason ?? 'UNKNOWN');
      return existing.toSnapshot();
    }

    try {
      await this.charger.activate(cmd);
    } catch (err) {
      const reason = err instanceof ChargerHardwareFaultError ? String(err.details?.reason) : (err as Error).message;
      await this.repository.createSession(ChargingSession.failed(cmd, reason, this.clock.now()));
      this.logger.error('falla de hardware al activar el cargador', { sagaId: cmd.sagaId, connectorId: cmd.connectorId, reason });
      throw err instanceof ChargerHardwareFaultError ? err : new ChargerHardwareFaultError(cmd.connectorId, reason);
    }

    const session = ChargingSession.start(cmd, this.clock.now());
    const created = await this.repository.createSession(session);
    if (!created) return (await this.repository.findSession(cmd.sagaId))!.toSnapshot();
    this.logger.info('flujo eléctrico iniciado', { sagaId: cmd.sagaId, connectorId: cmd.connectorId, powerKw: cmd.powerKw });
    return session.toSnapshot();
  }
}
