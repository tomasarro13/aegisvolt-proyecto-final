import { AppError } from '@aegisvolt/shared';

export class ChargerHardwareFaultError extends AppError {
  constructor(connectorId: string, reason: string) {
    super('CHARGER_HARDWARE_FAULT', `Falla física en el cargador ${connectorId}: ${reason}`, 409, { connectorId, reason });
  }
}

export class InvalidSessionStateError extends AppError {
  constructor(sagaId: string, status: string) {
    super('INVALID_SESSION_STATE', `La sesión ${sagaId} no está activa (estado ${status})`, 409, { sagaId, status });
  }
}
