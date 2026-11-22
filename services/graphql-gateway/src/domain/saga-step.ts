import type { SagaSnapshot } from './saga.js';

/**
 * Un paso de la SAGA con su acción y su transacción compensatoria.
 * Agregar un paso nuevo = crear otra implementación; el orquestador no cambia (OCP).
 */
export interface SagaStep<C> {
  readonly name: string;
  readonly service: string;
  execute(context: Readonly<C>): Promise<Partial<C>>;
  compensate(context: Readonly<C>, reason: string): Promise<void>;
}

export interface SagaRepository<C extends object = Record<string, unknown>> {
  save(snapshot: SagaSnapshot<C>): Promise<void>;
  find(sagaId: string): Promise<SagaSnapshot<C> | undefined>;
  list(limit: number): Promise<SagaSnapshot<C>[]>;
}
