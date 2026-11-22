import { NotFoundError, type Logger } from '@aegisvolt/shared';
import type { ReservationSnapshot } from '../domain/reservation.js';
import type { ReservationRepository } from '../domain/repositories.js';
import type { Clock } from './ports.js';

/** Confirma la SAGA (RESERVED -> CHARGING) y finaliza la sesión (CHARGING -> AVAILABLE). */
export class ChargingLifecycleUseCase {
  constructor(
    private readonly repository: ReservationRepository,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async startCharging(sagaId: string): Promise<ReservationSnapshot> {
    const { reservation, connector } = await this.load(sagaId);
    if (reservation.status === 'CHARGING') return reservation.toSnapshot(); // idempotente
    const now = this.clock.now();
    const expectedVersion = connector.version;
    reservation.startCharging(now);
    connector.startCharging(sagaId, now);
    await this.repository.save(reservation, { entity: connector, expectedVersion });
    this.logger.info('conector en carga', { sagaId, connectorId: connector.id });
    return reservation.toSnapshot();
  }

  async complete(sagaId: string): Promise<ReservationSnapshot> {
    const { reservation, connector } = await this.load(sagaId);
    if (reservation.status === 'COMPLETED') return reservation.toSnapshot(); // idempotente
    const now = this.clock.now();
    const expectedVersion = connector.version;
    reservation.complete(now);
    connector.finishCharging(sagaId, now);
    await this.repository.save(reservation, { entity: connector, expectedVersion });
    this.logger.info('sesión finalizada, conector disponible', { sagaId, connectorId: connector.id });
    return reservation.toSnapshot();
  }

  private async load(sagaId: string) {
    const reservation = await this.repository.findReservation(sagaId);
    if (!reservation) throw new NotFoundError('Reservation', sagaId);
    const connector = await this.repository.findConnector(reservation.stationId, reservation.connectorId);
    if (!connector) throw new NotFoundError('Connector', reservation.connectorId);
    return { reservation, connector };
  }
}
