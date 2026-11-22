import type { SagaSnapshot } from '../domain/saga.js';

/**
 * Puerto de observación de la SAGA (DIP). El orquestador notifica cada transición y la
 * implementación decide dónde reflejarla (Prefect, consola, nada). La observación es
 * "best effort": una implementación nunca debe lanzar ni bloquear la transacción de negocio.
 */
export type StepAction = 'EXECUTE' | 'COMPENSATE';

export interface SagaRun {
  /** Identificador del run en el sistema de observación (p. ej. flow run de Prefect). */
  id: string;
  /** URL para abrir el run en la UI. */
  url?: string;
}

export interface StepEvent {
  seq: number;
  step: string;
  service: string;
  action: StepAction;
  attempt: number;
}

export interface StepResult extends StepEvent {
  ok: boolean;
  durationMs: number;
  detail?: Record<string, unknown>;
  error?: { code: string; message: string; definitive?: boolean };
}

export interface SagaObserver {
  sagaStarted(saga: SagaSnapshot<object>): Promise<SagaRun | undefined>;
  stepStarted(run: SagaRun | undefined, event: StepEvent): Promise<string | undefined>;
  stepFinished(run: SagaRun | undefined, stepRunId: string | undefined, result: StepResult): Promise<void>;
  sagaFinished(run: SagaRun | undefined, saga: SagaSnapshot<object>): Promise<void>;
}

export const noopSagaObserver: SagaObserver = {
  sagaStarted: async () => undefined,
  stepStarted: async () => undefined,
  stepFinished: async () => undefined,
  sagaFinished: async () => undefined,
};
