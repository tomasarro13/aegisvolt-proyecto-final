import type { ChargingSessionSnapshot } from './charging-session.js';

/**
 * Puerto hacia el hardware del cargador (OCPP en producción). El dominio no sabe si es un
 * cargador real, un simulador o un inyector de fallos.
 */
export interface ChargerGateway {
  activate(session: Pick<ChargingSessionSnapshot, 'stationId' | 'connectorId' | 'powerKw' | 'sagaId'>): Promise<void>;
  deactivate(connectorId: string): Promise<void>;
}
