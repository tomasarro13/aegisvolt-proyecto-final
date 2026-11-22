import { AppError, NoopLogger } from '@aegisvolt/shared';
import { describe, expect, it } from 'vitest';
import { SagaOrchestrator } from '../../src/application/saga-orchestrator.js';
import type { SagaSnapshot } from '../../src/domain/saga.js';
import type { SagaRepository, SagaStep } from '../../src/domain/saga-step.js';

type Ctx = { sagaId: string; trail: string[] };

class MemoryRepo implements SagaRepository<Ctx> {
  readonly history: SagaSnapshot<Ctx>[] = [];
  private last = new Map<string, SagaSnapshot<Ctx>>();
  async save(s: SagaSnapshot<Ctx>) { this.history.push(s); this.last.set(s.sagaId, s); }
  async find(id: string) { return this.last.get(id); }
  async list() { return [...this.last.values()]; }
}

function step(name: string, log: string[], opts: { fail?: Error; compensateFailures?: number } = {}): SagaStep<Ctx> {
  let compensateFailures = opts.compensateFailures ?? 0;
  return {
    name,
    service: `${name}-svc`,
    async execute() {
      log.push(`exec:${name}`);
      if (opts.fail) throw opts.fail;
      return {};
    },
    async compensate() {
      if (compensateFailures-- > 0) throw new AppError('DOWN', 'temporal', 503);
      log.push(`comp:${name}`);
    },
  };
}

const clock = { now: () => new Date('2026-11-21T12:00:00Z') };
const make = (steps: SagaStep<Ctx>[], repo = new MemoryRepo()) =>
  ({ repo, orch: new SagaOrchestrator<Ctx>('TEST', steps, repo, clock, new NoopLogger(), 'test', { compensationRetries: 3, retryDelayMs: 1 }) });

describe('SagaOrchestrator', () => {
  it('completa la SAGA cuando todos los pasos tienen éxito', async () => {
    const log: string[] = [];
    const { orch } = make([step('A', log), step('B', log), step('C', log)]);
    const result = await orch.run('s1', { sagaId: 's1', trail: [] });
    expect(result.status).toBe('COMPLETED');
    expect(log).toEqual(['exec:A', 'exec:B', 'exec:C']);
    expect(result.steps.every((s) => s.status === 'SUCCEEDED')).toBe(true);
  });

  it('falla en paso 3 (hardware) => compensa paso 2 y luego paso 1, en orden inverso', async () => {
    const log: string[] = [];
    const fault = new AppError('CHARGER_HARDWARE_FAULT', 'falla', 409);
    const { orch } = make([step('RESERVE', log), step('CHARGE', log), step('ACTIVATE', log, { fail: fault })]);
    const result = await orch.run('s2', { sagaId: 's2', trail: [] });
    expect(result.status).toBe('COMPENSATED');
    expect(log).toEqual(['exec:RESERVE', 'exec:CHARGE', 'exec:ACTIVATE', 'comp:CHARGE', 'comp:RESERVE']);
    expect(result.failure).toMatchObject({ step: 'ACTIVATE', code: 'CHARGER_HARDWARE_FAULT' });
    expect(result.steps.map((s) => s.status)).toEqual(['COMPENSATED', 'COMPENSATED', 'FAILED']);
  });

  it('falla en paso 2 (fondos insuficientes) => solo libera el conector', async () => {
    const log: string[] = [];
    const { orch } = make([step('RESERVE', log), step('CHARGE', log, { fail: new AppError('INSUFFICIENT_FUNDS', 'sin saldo', 402) }), step('ACTIVATE', log)]);
    const result = await orch.run('s3', { sagaId: 's3', trail: [] });
    expect(result.status).toBe('COMPENSATED');
    expect(log).toEqual(['exec:RESERVE', 'exec:CHARGE', 'comp:RESERVE']);
    expect(result.steps.map((s) => s.status)).toEqual(['COMPENSATED', 'FAILED', 'SKIPPED']);
  });

  it('falla en paso 1 => FAILED sin compensaciones', async () => {
    const log: string[] = [];
    const { orch } = make([step('RESERVE', log, { fail: new AppError('CONNECTOR_UNAVAILABLE', 'ocupado', 409) }), step('CHARGE', log)]);
    const result = await orch.run('s4', { sagaId: 's4', trail: [] });
    expect(result.status).toBe('FAILED');
    expect(log).toEqual(['exec:RESERVE']);
  });

  it('falla incierta (timeout/5xx) => también compensa el paso que falló (compensación idempotente)', async () => {
    const log: string[] = [];
    const { orch } = make([step('RESERVE', log), step('CHARGE', log, { fail: new AppError('SERVICE_UNAVAILABLE', 'timeout', 503) })]);
    const result = await orch.run('s5', { sagaId: 's5', trail: [] });
    expect(result.status).toBe('COMPENSATED');
    expect(log).toEqual(['exec:RESERVE', 'exec:CHARGE', 'comp:CHARGE', 'comp:RESERVE']);
  });

  it('reintenta compensaciones transitorias con backoff', async () => {
    const log: string[] = [];
    const { orch } = make([step('RESERVE', log, { compensateFailures: 2 }), step('CHARGE', log, { fail: new AppError('INSUFFICIENT_FUNDS', 'x', 402) })]);
    const result = await orch.run('s6', { sagaId: 's6', trail: [] });
    expect(result.status).toBe('COMPENSATED');
    expect(log).toContain('comp:RESERVE');
  });

  it('marca COMPENSATION_FAILED si se agotan los reintentos (detectado luego por Prefect)', async () => {
    const log: string[] = [];
    const { orch } = make([step('RESERVE', log, { compensateFailures: 99 }), step('CHARGE', log, { fail: new AppError('INSUFFICIENT_FUNDS', 'x', 402) })]);
    const result = await orch.run('s7', { sagaId: 's7', trail: [] });
    expect(result.status).toBe('COMPENSATION_FAILED');
    expect(result.steps[0]?.status).toBe('COMPENSATION_FAILED');
  });

  it('persiste el log de la SAGA después de cada transición', async () => {
    const log: string[] = [];
    const { orch, repo } = make([step('A', log), step('B', log, { fail: new AppError('X', 'x', 409) })]);
    await orch.run('s8', { sagaId: 's8', trail: [] });
    expect(repo.history.map((h) => h.status)).toEqual(['STARTED', 'STARTED', 'STARTED', 'COMPENSATING', 'COMPENSATING', 'COMPENSATED']);
  });
});

describe('SagaOrchestrator + SagaObserver (Prefect)', () => {
  it('notifica flow run, cada paso y cada compensación en orden', async () => {
    const events: string[] = [];
    const observer = {
      sagaStarted: async () => { events.push('saga:start'); return { id: 'run-1', url: 'http://prefect/runs/flow-run/run-1' }; },
      stepStarted: async (_r: unknown, e: { action: string; step: string }) => { events.push(`${e.action}:${e.step}`); return `${e.action}:${e.step}`; },
      stepFinished: async (_r: unknown, _id: unknown, res: { ok: boolean; step: string; action: string }) => { events.push(`${res.ok ? 'ok' : 'fail'}:${res.action}:${res.step}`); },
      sagaFinished: async (_r: unknown, s: { status: string }) => { events.push(`saga:${s.status}`); },
    };
    const log: string[] = [];
    const repo = new MemoryRepo();
    const orch = new SagaOrchestrator<Ctx>('TEST', [step('RESERVE', log), step('CHARGE', log), step('ACTIVATE', log, { fail: new AppError('CHARGER_HARDWARE_FAULT', 'x', 409) })],
      repo, clock, new NoopLogger(), 'test', { compensationRetries: 3, retryDelayMs: 1, observer });
    const result = await orch.run('s9', { sagaId: 's9', trail: [] });
    expect(result.observabilityUrl).toBe('http://prefect/runs/flow-run/run-1');
    expect(events).toEqual([
      'saga:start',
      'EXECUTE:RESERVE', 'ok:EXECUTE:RESERVE',
      'EXECUTE:CHARGE', 'ok:EXECUTE:CHARGE',
      'EXECUTE:ACTIVATE', 'fail:EXECUTE:ACTIVATE',
      'COMPENSATE:CHARGE', 'ok:COMPENSATE:CHARGE',
      'COMPENSATE:RESERVE', 'ok:COMPENSATE:RESERVE',
      'saga:COMPENSATED',
    ]);
  });

  it('si el observador falla, la SAGA continúa', async () => {
    const broken = { sagaStarted: async () => { throw new Error('prefect caído'); }, stepStarted: async () => { throw new Error('x'); }, stepFinished: async () => undefined, sagaFinished: async () => undefined };
    const orch = new SagaOrchestrator<Ctx>('TEST', [step('A', [])], new MemoryRepo(), clock, new NoopLogger(), 'test', { compensationRetries: 1, retryDelayMs: 1, observer: broken });
    expect((await orch.run('s10', { sagaId: 's10', trail: [] })).status).toBe('COMPLETED');
  });
});
