export type SagaStatus =
  | 'STARTED'
  | 'COMPLETED'            // los 3 pasos OK: el vehículo está cargando
  | 'FINISHED'             // la sesión de carga terminó normalmente
  | 'FAILED'               // falló el primer paso: no había nada que compensar
  | 'COMPENSATING'
  | 'COMPENSATED'          // rollback distribuido completado
  | 'COMPENSATION_FAILED'; // requiere intervención: lo detecta el flujo de auditoría de Prefect

export type StepStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'COMPENSATED' | 'COMPENSATION_FAILED' | 'SKIPPED';

export interface StepRecord {
  name: string;
  service: string;
  status: StepStatus;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  compensatedAt?: string;
  error?: { code: string; message: string };
}

export interface SagaFailure {
  step: string;
  code: string;
  message: string;
}

export interface SagaSnapshot<C = Record<string, unknown>> {
  sagaId: string;
  type: string;
  environment: string;
  status: SagaStatus;
  context: C;
  steps: StepRecord[];
  failure?: SagaFailure;
  /** Enlace al run de la SAGA en el sistema de observación (Prefect). */
  observabilityUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export const TERMINAL_STATUSES: readonly SagaStatus[] = ['COMPLETED', 'FINISHED', 'FAILED', 'COMPENSATED', 'COMPENSATION_FAILED'];

/** Agregado que registra el log de ejecución de la SAGA (fuente de verdad del orquestador). */
export class Saga<C extends object> {
  private constructor(private state: SagaSnapshot<C>) {}

  static begin<C extends object>(props: { sagaId: string; type: string; environment: string; context: C; steps: { name: string; service: string }[] }, now: Date): Saga<C> {
    return new Saga({
      sagaId: props.sagaId,
      type: props.type,
      environment: props.environment,
      status: 'STARTED',
      context: props.context,
      steps: props.steps.map((s) => ({ ...s, status: 'PENDING', attempts: 0 })),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }

  static fromSnapshot<C extends object>(s: SagaSnapshot<C>): Saga<C> { return new Saga({ ...s, steps: s.steps.map((x) => ({ ...x })) }); }

  get id(): string { return this.state.sagaId; }
  get status(): SagaStatus { return this.state.status; }
  get context(): C { return this.state.context; }

  stepStarted(name: string, now: Date): void {
    this.updateStep(name, (s) => ({ ...s, attempts: s.attempts + 1, startedAt: now.toISOString() }), now);
  }

  stepSucceeded(name: string, contextPatch: Partial<C>, now: Date): void {
    this.state.context = { ...this.state.context, ...contextPatch };
    this.updateStep(name, (s) => ({ ...s, status: 'SUCCEEDED', finishedAt: now.toISOString(), error: undefined }), now);
  }

  stepFailed(name: string, error: { code: string; message: string }, now: Date): void {
    this.updateStep(name, (s) => ({ ...s, status: 'FAILED', finishedAt: now.toISOString(), error }), now);
    this.state.failure = { step: name, ...error };
    for (const s of this.state.steps) if (s.status === 'PENDING') s.status = 'SKIPPED';
  }

  linkObservability(url: string): void { this.state.observabilityUrl = url; }

  beginCompensation(now: Date): void { this.transition('COMPENSATING', now); }

  stepCompensated(name: string, now: Date): void {
    this.updateStep(name, (s) => ({ ...s, status: 'COMPENSATED', compensatedAt: now.toISOString() }), now);
  }

  stepCompensationFailed(name: string, error: { code: string; message: string }, now: Date): void {
    this.updateStep(name, (s) => ({ ...s, status: 'COMPENSATION_FAILED', error }), now);
  }

  complete(now: Date): void { this.transition('COMPLETED', now); }
  finish(now: Date): void { this.transition('FINISHED', now); }
  fail(now: Date): void { this.transition('FAILED', now); }
  compensated(now: Date): void { this.transition('COMPENSATED', now); }
  compensationFailed(now: Date): void { this.transition('COMPENSATION_FAILED', now); }

  toSnapshot(): SagaSnapshot<C> { return { ...this.state, steps: this.state.steps.map((s) => ({ ...s })) }; }

  private transition(status: SagaStatus, now: Date): void {
    this.state = { ...this.state, status, updatedAt: now.toISOString() };
  }

  private updateStep(name: string, fn: (s: StepRecord) => StepRecord, now: Date): void {
    const idx = this.state.steps.findIndex((s) => s.name === name);
    if (idx < 0) throw new Error(`Paso desconocido: ${name}`);
    this.state.steps[idx] = fn(this.state.steps[idx]!);
    this.state.updatedAt = now.toISOString();
  }
}
