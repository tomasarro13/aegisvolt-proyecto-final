import { AppError } from '@aegisvolt/shared';

export class InsufficientFundsError extends AppError {
  constructor(fleetId: string, required: number, available: number) {
    super('INSUFFICIENT_FUNDS', `Fondos insuficientes en la flota ${fleetId}: requiere ${required}, disponible ${available}`, 402, { fleetId, required, available });
  }
}
