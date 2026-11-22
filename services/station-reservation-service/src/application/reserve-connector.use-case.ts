import { NotFoundError, type FeatureFlagReader, type Logger } from '@aegisvolt/shared';
import { SagaAlreadyCompensatedError } from '../domain/errors.js';
import { Reservation, type ReservationSnapshot } from '../domain/reservation.js';
import type { ReservationRepository } from '../domain/repositories.js';
import type { Clock } from './ports.js';

export interface ReserveConnectorCommand {
  sagaId: string;
  stationId: string;
  connectorId: string;
  fleetId: string;
  fastChargeBoost: boolean;
}

export const STANDARD_HOLD_MINUTES = 15;
export const BOOST_HOLD_MINUTES = 30;

/** SAGA paso 1: bloquea temporalmente el conector (AVAILABLE -> RESERVED). Idempotente por sagaId. */
export class ReserveConnectorUseCase {
  constructor(
    private readonly repository: ReservationRepository,
    private readonly flags: FeatureFlagReader,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: ReserveConnectorCommand): Promise<ReservationSnapshot> {
    const existing = await this.repository.findReservation(cmd.sagaId);
    if (existing?.isActive) {
      this.logger.info('reserva ya existente (petición duplicada)', { sagaId: cmd.sagaId });
      return existing.toSnapshot();
    }
    if (existing?.status === 'RELEASED') throw new SagaAlreadyCompensatedError(cmd.sagaId);

    const connector = await this.repository.findConnector(cmd.stationId, cmd.connectorId);
    if (!connector) throw new NotFoundError('Connector', `${cmd.stationId}/${cmd.connectorId}`);

    const boost = cmd.fastChargeBoost && (await this.flags.isEnabled('ENABLE_FAST_CHARGE_BOOST'));
    const now = this.clock.now();
    const holdUntil = new Date(now.getTime() + (boost ? BOOST_HOLD_MINUTES : STANDARD_HOLD_MINUTES) * 60_000);

    const expectedVersion = connector.version;
    connector.reserve(cmd.sagaId, holdUntil, now);
    const reservation = Reservation.create({
      sagaId: cmd.sagaId,
      stationId: cmd.stationId,
      connectorId: cmd.connectorId,
      fleetId: cmd.fleetId,
      priorityBoost: boost,
      holdUntil: holdUntil.toISOString(),
    }, now);

    await this.repository.save(reservation, { entity: connector, expectedVersion });
    this.logger.info('conector reservado', { sagaId: cmd.sagaId, connectorId: cmd.connectorId, priorityBoost: boost });
    return reservation.toSnapshot();
  }
}
