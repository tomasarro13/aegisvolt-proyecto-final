import type { Logger } from '@aegisvolt/shared';
import { Reservation, type ReservationSnapshot } from '../domain/reservation.js';
import type { ReservationRepository } from '../domain/repositories.js';
import type { Clock } from './ports.js';

/**
 * Transacción compensatoria del paso 1: libera el conector (RESERVED -> AVAILABLE).
 * Idempotente: procesarla dos veces no cambia el resultado.
 */
export class ReleaseReservationUseCase {
  constructor(
    private readonly repository: ReservationRepository,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(sagaId: string, reason: string): Promise<ReservationSnapshot> {
    const now = this.clock.now();
    const reservation = await this.repository.findReservation(sagaId);

    if (!reservation) {
      const tombstone = Reservation.tombstone(sagaId, reason, now);
      await this.repository.save(tombstone);
      this.logger.warn('compensación sin reserva previa: se registra tombstone', { sagaId });
      return tombstone.toSnapshot();
    }
    if (reservation.status === 'RELEASED') {
      this.logger.info('compensación duplicada ignorada (idempotencia)', { sagaId });
      return reservation.toSnapshot();
    }

    const connector = await this.repository.findConnector(reservation.stationId, reservation.connectorId);
    reservation.release(reason, now);
    if (connector) {
      const expectedVersion = connector.version;
      const released = connector.release(sagaId, now);
      await this.repository.save(reservation, released ? { entity: connector, expectedVersion } : undefined);
    } else {
      await this.repository.save(reservation);
    }
    this.logger.info('COMPENSACIÓN: conector liberado', { sagaId, connectorId: reservation.connectorId, reason });
    return reservation.toSnapshot();
  }
}
