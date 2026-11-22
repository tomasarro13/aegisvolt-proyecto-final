import { NotFoundError, ValidationError, type Logger } from '@aegisvolt/shared';
import type { SagaSnapshot } from '../domain/saga.js';
import type { SagaRepository } from '../domain/saga-step.js';
import { CHARGING_SAGA_TYPE, type ChargingSagaContext } from './charging-saga-context.js';
import type { Clock, IdGenerator, StationPort } from './ports.js';
import { SagaOrchestrator } from './saga-orchestrator.js';
import type { SagaObserver } from './saga-observer.js';
import type { SagaStep } from '../domain/saga-step.js';

export interface StartChargingInput {
  fleetId: string;
  stationId: string;
  connectorId: string;
  estimatedKwh: number;
  fastChargeBoost?: boolean;
  /** Clave de idempotencia opcional del cliente: reenviar la mutación no crea otra SAGA. */
  idempotencyKey?: string;
}

type Ctx = ChargingSagaContext & { sagaId: string };

export class StartChargingSagaUseCase {
  private readonly orchestrator: SagaOrchestrator<Ctx>;

  constructor(
    private readonly stations: StationPort,
    steps: SagaStep<Ctx>[],
    private readonly repository: SagaRepository<Ctx>,
    private readonly ids: IdGenerator,
    clock: Clock,
    logger: Logger,
    environment: string,
    observer?: SagaObserver,
  ) {
    this.orchestrator = new SagaOrchestrator<Ctx>(CHARGING_SAGA_TYPE, steps, repository, clock, logger, environment, {
      compensationRetries: 3, retryDelayMs: 200, observer,
    });
  }

  async execute(input: StartChargingInput): Promise<SagaSnapshot<Ctx>> {
    if (!(input.estimatedKwh > 0 && input.estimatedKwh <= 500)) throw new ValidationError('estimatedKwh debe estar entre 0 y 500');

    const sagaId = input.idempotencyKey ? `saga-${input.idempotencyKey}` : this.ids.next();
    const previous = await this.repository.find(sagaId);
    if (previous) return previous;

    const station = await this.stations.getStation(input.stationId);
    const connector = station.connectors.find((c) => c.connectorId === input.connectorId);
    if (!connector) throw new NotFoundError('Connector', input.connectorId);

    return this.orchestrator.run(sagaId, {
      sagaId,
      fleetId: input.fleetId,
      stationId: input.stationId,
      connectorId: input.connectorId,
      estimatedKwh: input.estimatedKwh,
      fastChargeBoost: input.fastChargeBoost ?? false,
      powerKw: connector.powerKw,
    });
  }
}
