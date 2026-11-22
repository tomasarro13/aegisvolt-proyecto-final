import { ConflictError, NotFoundError, runWithContext, type Logger } from '@aegisvolt/shared';
import { Saga, type SagaSnapshot } from '../domain/saga.js';
import type { SagaRepository } from '../domain/saga-step.js';
import type { ChargingSagaContext } from './charging-saga-context.js';
import type { Clock, DispatchPort, StationPort } from './ports.js';

type Ctx = ChargingSagaContext & { sagaId: string };

/** Termina normalmente una sesión: detiene el flujo eléctrico y libera el conector. */
export class StopChargingSessionUseCase {
  constructor(
    private readonly repository: SagaRepository<Ctx>,
    private readonly dispatch: DispatchPort,
    private readonly stations: StationPort,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(sagaId: string): Promise<SagaSnapshot<Ctx>> {
    return runWithContext({ correlationId: sagaId }, async () => {
      const snapshot = await this.repository.find(sagaId);
      if (!snapshot) throw new NotFoundError('Saga', sagaId);
      if (snapshot.status === 'FINISHED') return snapshot;
      if (snapshot.status !== 'COMPLETED') throw new ConflictError('SAGA_NOT_ACTIVE', `La SAGA ${sagaId} no tiene una sesión activa (estado ${snapshot.status})`);

      await this.dispatch.stop(sagaId);
      await this.stations.complete(sagaId);
      const saga = Saga.fromSnapshot(snapshot);
      saga.finish(this.clock.now());
      await this.repository.save(saga.toSnapshot());
      this.logger.info('sesión de carga finalizada', { saga_id: sagaId });
      return saga.toSnapshot();
    });
  }
}
