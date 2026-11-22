import { ForbiddenFlagChange } from './errors.js';
import type { FeatureFlag, FeatureFlagAdmin, FlagKey, Logger } from '@aegisvolt/shared';
import type { SagaRepository } from '../domain/saga-step.js';
import type { ChargingSagaContext } from './charging-saga-context.js';
import type { BillingPort, DispatchPort, HealthPort, StationPort } from './ports.js';

/** Fachada de lectura para la capa GraphQL (agrega datos de los 3 microservicios). */
export class DashboardQueries {
  constructor(
    readonly stations: StationPort,
    readonly billing: BillingPort,
    readonly dispatch: DispatchPort,
    readonly sagas: SagaRepository<ChargingSagaContext & { sagaId: string }>,
    private readonly health: HealthPort[],
  ) {}

  async systemHealth() {
    return Promise.all(this.health.map(async (h) => {
      try { return { service: h.name, ...(await h.check()) }; } catch (err) {
        return { service: h.name, status: 'DOWN', latencyMs: -1, detail: (err as Error).message };
      }
    }));
  }
}

/** Administración de feature flags con política por ambiente (en prod se bloquea por defecto). */
export class FeatureFlagAdminUseCase {
  constructor(private readonly flags: FeatureFlagAdmin, private readonly mutationsAllowed: boolean, private readonly logger: Logger) {}

  list(): Promise<FeatureFlag[]> { return this.flags.list(); }

  async set(key: FlagKey, enabled: boolean, actor: string): Promise<FeatureFlag> {
    if (!this.mutationsAllowed) throw new ForbiddenFlagChange();
    const flag = await this.flags.set(key, enabled, actor);
    this.logger.info('feature flag cambiada desde el panel', { flag: key, enabled, actor });
    return flag;
  }
}
