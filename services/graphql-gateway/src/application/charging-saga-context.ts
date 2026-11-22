/** Contexto que viaja entre los pasos de la SAGA "Reservar y Activar Carga". */
export interface ChargingSagaContext {
  fleetId: string;
  stationId: string;
  connectorId: string;
  estimatedKwh: number;
  fastChargeBoost: boolean;
  powerKw: number;
  // Completados por los pasos:
  priorityBoost?: boolean;
  holdUntil?: string;
  chargedAmount?: number;
  currency?: string;
  pricingStrategy?: string;
  surgeMultiplier?: number;
  sessionStartedAt?: string;
}

export const CHARGING_SAGA_TYPE = 'RESERVE_AND_ACTIVATE_CHARGING';
