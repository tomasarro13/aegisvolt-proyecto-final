import type { ChargingSessionSnapshot } from './charging-session.js';

export interface TelemetrySample {
  sagaId: string;
  connectorId: string;
  at: string;
  powerKw: number;
  deliveredKwh: number;
  voltageV: number;
  currentA: number;
  temperatureC: number;
}

/**
 * Modelo físico simplificado (función pura): curva de carga con "taper" al acercarse al objetivo,
 * como ocurre en baterías de ion-litio por encima del 80 %.
 */
export function simulateSample(session: ChargingSessionSnapshot, at: Date): TelemetrySample {
  const elapsedH = Math.max(0, (at.getTime() - new Date(session.startedAt).getTime()) / 3_600_000);
  // Acelerado x6 para que la demo muestre progreso visible (10 min reales = 1 h de carga).
  const linearKwh = session.powerKw * elapsedH * 6;
  const deliveredKwh = Math.min(session.targetKwh, linearKwh);
  const progress = session.targetKwh > 0 ? deliveredKwh / session.targetKwh : 1;
  const taper = progress < 0.8 ? 1 : Math.max(0.15, 1 - (progress - 0.8) * 4);
  const powerKw = deliveredKwh >= session.targetKwh ? 0 : round(session.powerKw * taper * (0.97 + 0.03 * Math.sin(elapsedH * 500)));
  const voltageV = session.powerKw >= 50 ? round(400 + 40 * progress) : 230;
  return {
    sagaId: session.sagaId,
    connectorId: session.connectorId,
    at: at.toISOString(),
    powerKw,
    deliveredKwh: round(deliveredKwh),
    voltageV,
    currentA: round((powerKw * 1000) / voltageV),
    temperatureC: round(28 + 12 * progress + powerKw / 50),
  };
}

const round = (n: number): number => Math.round(n * 100) / 100;
