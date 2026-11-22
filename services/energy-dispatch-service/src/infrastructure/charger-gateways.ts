import type { FeatureFlagReader, Logger } from '@aegisvolt/shared';
import type { ChargerGateway } from '../domain/charger-gateway.js';
import { ChargerHardwareFaultError } from '../domain/errors.js';

/** Simulador de cargador OCPP: responde como lo haría el hardware (latencia incluida). */
export class SimulatedChargerGateway implements ChargerGateway {
  constructor(private readonly logger: Logger, private readonly latencyMs = 150) {}

  async activate(session: { connectorId: string; powerKw: number }): Promise<void> {
    await new Promise((r) => setTimeout(r, this.latencyMs));
    this.logger.debug('OCPP RemoteStartTransaction aceptado', { connectorId: session.connectorId });
  }

  async deactivate(connectorId: string): Promise<void> {
    this.logger.debug('OCPP RemoteStopTransaction aceptado', { connectorId });
  }
}

/**
 * Decorator de inyección de fallos: si SIMULATE_CHARGER_HARDWARE_FAULT está activa en el ambiente,
 * el cargador reporta una falla física. Se agrega sin modificar el simulador ni el caso de uso (OCP).
 */
export class FaultInjectingChargerGateway implements ChargerGateway {
  constructor(private readonly inner: ChargerGateway, private readonly flags: FeatureFlagReader, private readonly logger: Logger) {}

  async activate(session: { stationId: string; connectorId: string; powerKw: number; sagaId: string }): Promise<void> {
    if (await this.flags.isEnabled('SIMULATE_CHARGER_HARDWARE_FAULT')) {
      this.logger.warn('fallo de hardware inyectado por feature flag', { connectorId: session.connectorId });
      throw new ChargerHardwareFaultError(session.connectorId, 'GROUND_FAULT_DETECTED (SIMULATE_CHARGER_HARDWARE_FAULT)');
    }
    await this.inner.activate(session);
  }

  deactivate(connectorId: string): Promise<void> {
    return this.inner.deactivate(connectorId);
  }
}
