import { AppError, runWithContext, type Logger } from '@aegisvolt/shared';
import { Saga, type SagaSnapshot } from '../domain/saga.js';
import type { SagaRepository, SagaStep } from '../domain/saga-step.js';
import type { Clock } from './ports.js';
import { noopSagaObserver, type SagaObserver, type SagaRun, type StepAction } from './saga-observer.js';

export interface OrchestratorOptions {
  compensationRetries: number;
  retryDelayMs: number;
  /** Dónde se refleja la ejecución (Prefect). Por defecto no se observa. */
  observer?: SagaObserver;
}

interface ClassifiedError { code: string; message: string; definitive: boolean }

/**
 * Orquestador genérico de SAGAs (patrón SAGA por orquestación).
 *  - Ejecuta los pasos en orden y persiste el log después de cada transición.
 *  - Ante una falla compensa en orden inverso los pasos exitosos.
 *  - Si la falla es incierta (timeout / 5xx: el paso pudo haberse aplicado) también compensa ese
 *    paso; es seguro porque toda compensación es idempotente.
 *  - Las compensaciones se reintentan con backoff; si se agotan los reintentos la SAGA queda
 *    COMPENSATION_FAILED y el flujo de Prefect la reporta como huérfana.
 *  - Cada paso y cada intento de compensación se notifican al SagaObserver (Prefect: flow run por
 *    SAGA, task run por intento).
 */
export class SagaOrchestrator<C extends object> {
  private readonly observer: SagaObserver;

  constructor(
    private readonly type: string,
    private readonly steps: SagaStep<C>[],
    private readonly repository: SagaRepository<C>,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly environment: string,
    private readonly options: OrchestratorOptions = { compensationRetries: 3, retryDelayMs: 200 },
  ) {
    this.observer = options.observer ?? noopSagaObserver;
  }

  run(sagaId: string, initialContext: C): Promise<SagaSnapshot<C>> {
    return runWithContext({ correlationId: sagaId }, () => this.doRun(sagaId, initialContext));
  }

  private async doRun(sagaId: string, initialContext: C): Promise<SagaSnapshot<C>> {
    const saga = Saga.begin<C>({
      sagaId,
      type: this.type,
      environment: this.environment,
      context: initialContext,
      steps: this.steps.map((s) => ({ name: s.name, service: s.service })),
    }, this.clock.now());
    const run = await this.safe(() => this.observer.sagaStarted(saga.toSnapshot()));
    if (run?.url) saga.linkObservability(run.url);
    await this.persist(saga);
    this.logger.info('SAGA iniciada', { saga_type: this.type, saga_id: sagaId, prefect_run: run?.url });

    const ctx = { run, seq: 0 };
    const toCompensate: SagaStep<C>[] = [];
    for (const step of this.steps) {
      saga.stepStarted(step.name, this.clock.now());
      const started = performance.now();
      const stepRunId = await this.notifyStart(ctx, step, 'EXECUTE', 1);
      try {
        const patch = await step.execute(saga.context);
        saga.stepSucceeded(step.name, patch, this.clock.now());
        toCompensate.push(step);
        await this.persist(saga);
        await this.notifyEnd(ctx, stepRunId, step, 'EXECUTE', 1, started, { ok: true, detail: patch as Record<string, unknown> });
        this.logger.info('paso SAGA completado', { saga_id: sagaId, step: step.name, target_service: step.service });
      } catch (err) {
        const error = classify(err);
        saga.stepFailed(step.name, { code: error.code, message: error.message }, this.clock.now());
        await this.persist(saga);
        await this.notifyEnd(ctx, stepRunId, step, 'EXECUTE', 1, started, { ok: false, error });
        this.logger.error('paso SAGA falló', { saga_id: sagaId, step: step.name, target_service: step.service, error_code: error.code, error_message: error.message, definitive: error.definitive });
        if (!error.definitive) toCompensate.push(step);
        return this.compensate(saga, toCompensate, `${step.name}:${error.code}`, ctx);
      }
    }

    saga.complete(this.clock.now());
    await this.persist(saga);
    await this.safe(() => this.observer.sagaFinished(run, saga.toSnapshot()));
    this.logger.info('SAGA completada', { saga_id: sagaId });
    return saga.toSnapshot();
  }

  private async compensate(saga: Saga<C>, executed: SagaStep<C>[], reason: string, ctx: { run?: SagaRun; seq: number }): Promise<SagaSnapshot<C>> {
    if (executed.length === 0) {
      saga.fail(this.clock.now());
      await this.persist(saga);
      await this.safe(() => this.observer.sagaFinished(ctx.run, saga.toSnapshot()));
      this.logger.warn('SAGA fallida sin pasos que compensar', { saga_id: saga.id, reason });
      return saga.toSnapshot();
    }

    saga.beginCompensation(this.clock.now());
    await this.persist(saga);
    this.logger.warn('iniciando compensación distribuida', { saga_id: saga.id, reason, steps: executed.map((s) => s.name).reverse() });

    let allOk = true;
    for (const step of [...executed].reverse()) {
      const ok = await this.compensateWithRetry(saga, step, reason, ctx);
      allOk &&= ok;
      await this.persist(saga);
    }

    if (allOk) saga.compensated(this.clock.now());
    else saga.compensationFailed(this.clock.now());
    await this.persist(saga);
    await this.safe(() => this.observer.sagaFinished(ctx.run, saga.toSnapshot()));
    this.logger[allOk ? 'warn' : 'error'](allOk ? 'SAGA compensada' : 'SAGA con compensación fallida (requiere intervención)', { saga_id: saga.id, status: saga.status });
    return saga.toSnapshot();
  }

  private async compensateWithRetry(saga: Saga<C>, step: SagaStep<C>, reason: string, ctx: { run?: SagaRun; seq: number }): Promise<boolean> {
    let last: ClassifiedError | undefined;
    for (let attempt = 1; attempt <= this.options.compensationRetries; attempt++) {
      const started = performance.now();
      const stepRunId = await this.notifyStart(ctx, step, 'COMPENSATE', attempt);
      try {
        await step.compensate(saga.context, reason);
        saga.stepCompensated(step.name, this.clock.now());
        await this.notifyEnd(ctx, stepRunId, step, 'COMPENSATE', attempt, started, { ok: true, detail: { reason } });
        this.logger.info('compensación aplicada', { saga_id: saga.id, step: step.name, target_service: step.service, attempt });
        return true;
      } catch (err) {
        last = classify(err);
        await this.notifyEnd(ctx, stepRunId, step, 'COMPENSATE', attempt, started, { ok: false, error: last });
        this.logger.warn('reintento de compensación', { saga_id: saga.id, step: step.name, attempt, error_code: last.code });
        await new Promise((r) => setTimeout(r, this.options.retryDelayMs * 2 ** (attempt - 1)));
      }
    }
    saga.stepCompensationFailed(step.name, { code: last?.code ?? 'UNKNOWN', message: last?.message ?? '' }, this.clock.now());
    return false;
  }

  private notifyStart(ctx: { run?: SagaRun; seq: number }, step: SagaStep<C>, action: StepAction, attempt: number): Promise<string | undefined> {
    ctx.seq += 1;
    return this.safe(() => this.observer.stepStarted(ctx.run, { seq: ctx.seq, step: step.name, service: step.service, action, attempt }));
  }

  private async notifyEnd(
    ctx: { run?: SagaRun; seq: number }, stepRunId: string | undefined, step: SagaStep<C>, action: StepAction, attempt: number, started: number,
    result: { ok: boolean; detail?: Record<string, unknown>; error?: ClassifiedError },
  ): Promise<void> {
    await this.safe(() => this.observer.stepFinished(ctx.run, stepRunId, {
      seq: ctx.seq, step: step.name, service: step.service, action, attempt, durationMs: Math.round(performance.now() - started), ...result,
    }));
  }

  /** La observación nunca rompe la SAGA. */
  private async safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try { return await fn(); } catch (err) {
      this.logger.warn('observador de SAGA no disponible', { error: err });
      return undefined;
    }
  }

  private persist(saga: Saga<C>): Promise<void> {
    return this.repository.save(saga.toSnapshot());
  }
}

/** Error de negocio (4xx) = definitivo; red/timeout/5xx = incierto. */
function classify(err: unknown): ClassifiedError {
  if (err instanceof AppError) return { code: err.code, message: err.message, definitive: err.httpStatus < 500 };
  return { code: 'UNEXPECTED_ERROR', message: (err as Error)?.message ?? String(err), definitive: false };
}
