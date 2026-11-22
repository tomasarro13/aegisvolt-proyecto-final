import type { ConnectorStatus, SagaStatus, SagaTransaction, StepStatus } from './models';

/** Reglas de presentación puras (testeables sin UI). */
export const STEP_LABELS: Record<string, string> = {
  RESERVE_CONNECTOR: 'Reserva de conector',
  CHARGE_WALLET: 'Cobro a billetera',
  ACTIVATE_CHARGER: 'Activación física',
  CONFIRM_CONNECTOR_CHARGING: 'Confirmación de carga',
};

export const STEP_TONE: Record<StepStatus, 'ok' | 'bad' | 'warn' | 'idle'> = {
  SUCCEEDED: 'ok', FAILED: 'bad', COMPENSATED: 'warn', COMPENSATION_FAILED: 'bad', PENDING: 'idle', SKIPPED: 'idle',
};

export const SAGA_TONE: Record<SagaStatus, 'ok' | 'bad' | 'warn' | 'idle'> = {
  COMPLETED: 'ok', FINISHED: 'ok', STARTED: 'idle', COMPENSATING: 'warn', COMPENSATED: 'warn', FAILED: 'bad', COMPENSATION_FAILED: 'bad',
};

export const CONNECTOR_TONE: Record<ConnectorStatus, 'ok' | 'warn' | 'info' | 'bad'> = {
  AVAILABLE: 'ok', RESERVED: 'warn', CHARGING: 'info', OUT_OF_SERVICE: 'bad',
};

export const isActiveSession = (s: SagaTransaction) => s.status === 'COMPLETED';

export function formatMoney(amount: number | null | undefined, currency = 'COP'): string {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `hace ${s}s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return `hace ${Math.round(s / 3600)} h`;
}

export function connectorKind(powerKw: number): string {
  if (powerKw >= 150) return 'Ultra';
  if (powerKw >= 50) return 'DC rápido';
  return 'AC';
}
