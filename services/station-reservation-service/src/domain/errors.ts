import { AppError, ConflictError } from '@aegisvolt/shared';

export class ConnectorUnavailableError extends ConflictError {
  constructor(connectorId: string, status: string) {
    super('CONNECTOR_UNAVAILABLE', `El conector ${connectorId} no está disponible (estado ${status})`, { connectorId, status });
  }
}

export class SagaAlreadyCompensatedError extends ConflictError {
  constructor(sagaId: string) {
    super('SAGA_ALREADY_COMPENSATED', `La SAGA ${sagaId} ya fue compensada; no se puede volver a reservar`, { sagaId });
  }
}

export class InvalidStateTransitionError extends AppError {
  constructor(entity: string, from: string, to: string) {
    super('INVALID_STATE_TRANSITION', `${entity}: transición inválida ${from} -> ${to}`, 409, { entity, from, to });
  }
}
