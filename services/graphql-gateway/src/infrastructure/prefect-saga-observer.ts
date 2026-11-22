import type { Logger } from '@aegisvolt/shared';
import type { SagaObserver, SagaRun, StepEvent, StepResult } from '../application/saga-observer.js';
import type { SagaSnapshot, SagaStatus } from '../domain/saga.js';

/**
 * Refleja cada SAGA en Prefect usando su API REST:
 *   - un flow run del flow "saga-reservar-y-activar-carga" por SAGA (nombre: <env>·<sagaId>),
 *   - un task run por cada intento de cada paso; las compensaciones aparecen como
 *     "COMPENSAR <PASO>" encadenadas al paso anterior (el grafo de Prefect dibuja avance y rollback),
 *   - logs ▶ ENTRA / ◀ SALE / ✖ ERROR / ↺ COMPENSA con el correlation_id,
 *   - un artifact markdown con la bitácora final y el estado final del flow run
 *     (Completada / Compensada / Fallida / Compensación fallida).
 * Prefect NO decide nada: el orquestador es la fuente de verdad. Es "best effort" con circuit breaker.
 */
const FLOW_NAME = 'saga-reservar-y-activar-carga';

const LABEL: Record<string, string> = {
  RESERVE_CONNECTOR: 'Reservar conector',
  CHARGE_WALLET: 'Cobrar billetera',
  ACTIVATE_CHARGER: 'Activar cargador',
  CONFIRM_CONNECTOR_CHARGING: 'Confirmar carga',
};

const FINAL_STATE: Partial<Record<SagaStatus, { type: string; name: string }>> = {
  COMPLETED: { type: 'COMPLETED', name: 'Completada' },
  FAILED: { type: 'FAILED', name: 'Fallida' },
  COMPENSATED: { type: 'FAILED', name: 'Compensada' },
  COMPENSATION_FAILED: { type: 'CRASHED', name: 'Compensación fallida' },
};

const LEVEL = { info: 20, warn: 30, error: 40 } as const;

interface PrefectRun extends SagaRun { lastTaskRunId?: string; sagaId: string }

export class PrefectSagaObserver implements SagaObserver {
  private flowId?: string;
  private disabledUntil = 0;

  constructor(
    private readonly apiUrl: string,
    private readonly uiUrl: string,
    private readonly environment: string,
    private readonly logger: Logger,
  ) {}

  async sagaStarted(saga: SagaSnapshot<object>): Promise<SagaRun | undefined> {
    const flowId = await this.ensureFlow();
    if (!flowId) return undefined;
    const ctx = saga.context as Record<string, unknown>;
    const flowRun = await this.call<{ id: string }>('POST', '/flow_runs/', {
      flow_id: flowId,
      name: `${this.environment}·${saga.sagaId.replace(/^saga-/, '').slice(0, 13)}`,
      parameters: {
        sagaId: saga.sagaId, environment: this.environment, fleetId: ctx.fleetId, stationId: ctx.stationId,
        connectorId: ctx.connectorId, estimatedKwh: ctx.estimatedKwh, fastChargeBoost: ctx.fastChargeBoost,
      },
      tags: ['saga', `env:${this.environment}`, String(ctx.stationId ?? '')].filter(Boolean),
      state: { type: 'RUNNING', name: 'Running' },
    });
    if (!flowRun) return undefined;
    const run: PrefectRun = { id: flowRun.id, url: `${this.uiUrl}/runs/flow-run/${flowRun.id}`, sagaId: saga.sagaId };
    await this.log(run, 'info', `SAGA ${saga.sagaId} iniciada en ${this.environment} · flota=${ctx.fleetId} · conector=${ctx.connectorId} · ${ctx.estimatedKwh} kWh`);
    return run;
  }

  async stepStarted(run: SagaRun | undefined, e: StepEvent): Promise<string | undefined> {
    const r = run as PrefectRun | undefined;
    if (!r) return undefined;
    const compensating = e.action === 'COMPENSATE';
    const taskRun = await this.call<{ id: string }>('POST', '/task_runs/', {
      flow_run_id: r.id,
      task_key: `${e.action}:${e.step}`,
      dynamic_key: String(e.seq),
      name: `${compensating ? 'COMPENSAR ' : ''}${e.step} [intento ${e.attempt}]`,
      tags: [e.service, compensating ? 'compensacion' : 'ejecucion', ...(e.step === 'CONFIRM_CONNECTOR_CHARGING' ? ['pivote'] : [])],
      // dependencia con el task run anterior => el grafo muestra la cadena avance -> falla -> compensaciones
      task_inputs: r.lastTaskRunId ? { paso_anterior: [{ input_type: 'task_run', id: r.lastTaskRunId }] } : {},
      state: { type: 'RUNNING', name: compensating ? 'Compensando' : e.attempt > 1 ? 'Reintentando' : 'Running' },
    });
    if (!taskRun) return undefined;
    r.lastTaskRunId = taskRun.id;
    await this.log(r, compensating ? 'warn' : 'info',
      `${compensating ? '↺ COMPENSA' : '▶ ENTRA'}  ${LABEL[e.step] ?? e.step} · servicio=${e.service} · intento ${e.attempt}`, taskRun.id);
    return taskRun.id;
  }

  async stepFinished(run: SagaRun | undefined, taskRunId: string | undefined, res: StepResult): Promise<void> {
    const r = run as PrefectRun | undefined;
    if (!r || !taskRunId) return;
    const message = res.error ? `${res.error.code}: ${res.error.message}` : describe(res.detail);
    await this.call('POST', `/task_runs/${taskRunId}/set_state`, {
      state: res.ok
        ? { type: 'COMPLETED', name: res.action === 'COMPENSATE' ? 'Compensado' : 'Completed', message }
        : { type: 'FAILED', name: res.error?.definitive === false ? 'Falló (incierto)' : 'Falló', message },
      force: true,
    });
    await this.log(r, res.ok ? 'info' : 'error',
      `${res.ok ? '◀ SALE ' : '✖ ERROR'}  ${LABEL[res.step] ?? res.step} · ${message} · ${res.durationMs} ms`, taskRunId);
  }

  async sagaFinished(run: SagaRun | undefined, saga: SagaSnapshot<object>): Promise<void> {
    const r = run as PrefectRun | undefined;
    if (!r) return;
    const state = FINAL_STATE[saga.status];
    if (!state) return;
    const ctx = saga.context as Record<string, unknown>;
    const rows = saga.steps.map((s, i) =>
      `| ${i + 1} | ${LABEL[s.name] ?? s.name} | ${s.service} | ${s.status === 'COMPENSATED' ? '↺ ' : ''}${s.status} | ${s.attempts} | ${s.error ? `${s.error.code}` : '-'} |`);
    await this.call('POST', '/artifacts/', {
      key: `saga-${saga.sagaId.replace(/^saga-/, '').slice(0, 8).toLowerCase()}`,
      type: 'markdown',
      flow_run_id: r.id,
      description: `Bitácora de la SAGA ${saga.sagaId} (${this.environment})`,
      data: [
        `## SAGA ${saga.sagaId}`,
        `**Ambiente:** ${this.environment} · **Estado final:** ${state.name} · **correlation_id:** \`${saga.sagaId}\``,
        saga.failure ? `**Falla:** paso \`${saga.failure.step}\` → \`${saga.failure.code}\` — ${saga.failure.message}` : '',
        ctx.chargedAmount ? `**Monto:** ${ctx.chargedAmount} ${ctx.currency ?? ''} · tarifa ${ctx.pricingStrategy ?? ''}` : '',
        '',
        '| # | Paso | Servicio | Estado | Intentos | Error |',
        '|---|---|---|---|---|---|',
        ...rows,
        '',
        saga.status === 'COMPENSATED' ? '_Rollback distribuido aplicado en orden inverso: reembolso (billing) y liberación del conector (reservas)._' : '',
      ].filter((l) => l !== undefined).join('\n'),
    });
    await this.log(r, saga.status === 'COMPLETED' ? 'info' : 'warn', `■ SAGA ${state.name}${saga.failure ? ` · ${saga.failure.step}:${saga.failure.code}` : ''}`);
    await this.call('POST', `/flow_runs/${r.id}/set_state`, {
      state: { ...state, message: saga.failure ? `${saga.failure.step}: ${saga.failure.code}` : 'Reserva, cobro y activación completados' },
      force: true,
    });
  }

  private async ensureFlow(): Promise<string | undefined> {
    if (!this.flowId) this.flowId = (await this.call<{ id: string }>('POST', '/flows/', { name: FLOW_NAME, tags: ['aegisvolt', 'saga'] }))?.id;
    return this.flowId;
  }

  private async log(run: PrefectRun, level: keyof typeof LEVEL, message: string, taskRunId?: string): Promise<void> {
    await this.call('POST', '/logs/', [{
      name: 'aegisvolt.saga', level: LEVEL[level], message: `[${run.sagaId}] ${message}`, timestamp: new Date().toISOString(),
      flow_run_id: run.id, task_run_id: taskRunId ?? null,
    }]);
  }

  private async call<T = unknown>(method: string, path: string, body?: unknown): Promise<T | undefined> {
    if (Date.now() < this.disabledUntil) return undefined;
    try {
      const res = await fetch(`${this.apiUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return (res.status === 204 ? {} : await res.json()) as T;
    } catch (err) {
      this.disabledUntil = Date.now() + 30_000; // circuit breaker: la SAGA nunca espera a Prefect
      this.logger.warn('prefect no disponible; se reintenta en 30 s (la SAGA continúa)', { method, path, error: (err as Error).message });
      return undefined;
    }
  }
}

function describe(detail?: Record<string, unknown>): string {
  if (!detail) return 'ok';
  const entries = Object.entries(detail).filter(([, v]) => v !== undefined);
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(' · ') : 'ok';
}
