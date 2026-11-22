import { InMemoryFeatureFlags, NoopLogger } from '@aegisvolt/shared';
import { describe, expect, it } from 'vitest';
import { ActivateChargerUseCase } from '../../src/application/activate-charger.use-case.js';
import { SessionService } from '../../src/application/session-service.js';
import { ChargingSession, type ChargingSessionSnapshot } from '../../src/domain/charging-session.js';
import type { DispatchRepository } from '../../src/domain/repositories.js';
import { simulateSample, type TelemetrySample } from '../../src/domain/telemetry.js';
import { FaultInjectingChargerGateway, SimulatedChargerGateway } from '../../src/infrastructure/charger-gateways.js';

class MemoryRepo implements DispatchRepository {
  sessions = new Map<string, ChargingSessionSnapshot>();
  telemetrySamples: TelemetrySample[] = [];
  async findSession(id: string) { const s = this.sessions.get(id); return s ? ChargingSession.fromSnapshot(s) : undefined; }
  async listSessions() { return [...this.sessions.values()].map(ChargingSession.fromSnapshot); }
  async listActiveSessions() { return [...this.sessions.values()].filter((s) => s.status === 'ACTIVE').map(ChargingSession.fromSnapshot); }
  async createSession(s: ChargingSession) { if (this.sessions.has(s.sagaId)) return false; this.sessions.set(s.sagaId, s.toSnapshot()); return true; }
  async updateSession(s: ChargingSession) { this.sessions.set(s.sagaId, s.toSnapshot()); }
  async appendTelemetry(t: TelemetrySample) { this.telemetrySamples.push(t); }
  async listTelemetry() { return this.telemetrySamples; }
}

const clock = { now: () => new Date('2026-11-21T12:00:00Z') };
const cmd = { sagaId: 'saga-1', stationId: 'S1', connectorId: 'C1', fleetId: 'F1', powerKw: 60, targetKwh: 30 };
const setup = (fault: boolean) => {
  const repo = new MemoryRepo();
  const logger = new NoopLogger();
  const charger = new FaultInjectingChargerGateway(new SimulatedChargerGateway(logger, 0), new InMemoryFeatureFlags({ SIMULATE_CHARGER_HARDWARE_FAULT: fault }), logger);
  return { repo, activate: new ActivateChargerUseCase(repo, charger, clock, logger), sessions: new SessionService(repo, charger, clock, logger) };
};

describe('ActivateChargerUseCase', () => {
  it('inicia la sesión ACTIVE', async () => {
    const { activate } = setup(false);
    expect((await activate.execute(cmd)).status).toBe('ACTIVE');
  });

  it('SIMULATE_CHARGER_HARDWARE_FAULT provoca CHARGER_HARDWARE_FAULT y registra la sesión FAILED', async () => {
    const { activate, repo } = setup(true);
    await expect(activate.execute(cmd)).rejects.toMatchObject({ code: 'CHARGER_HARDWARE_FAULT' });
    expect(repo.sessions.get('saga-1')?.status).toBe('FAILED');
  });

  it('un reintento de una activación fallida devuelve la misma falla (idempotencia determinista)', async () => {
    const { activate } = setup(true);
    await expect(activate.execute(cmd)).rejects.toThrow();
    await expect(activate.execute(cmd)).rejects.toMatchObject({ code: 'CHARGER_HARDWARE_FAULT' });
  });

  it('detener dos veces es idempotente', async () => {
    const { activate, sessions } = setup(false);
    await activate.execute(cmd);
    expect((await sessions.stop('saga-1')).status).toBe('STOPPED');
    expect((await sessions.stop('saga-1')).status).toBe('STOPPED');
  });
});

describe('telemetría simulada', () => {
  it('nunca excede la energía objetivo y reduce potencia al final (taper)', () => {
    const base = { ...cmd, deliveredKwh: 0, status: 'ACTIVE' as const, startedAt: '2026-11-21T12:00:00Z', updatedAt: '' };
    const late = simulateSample(base, new Date('2026-11-21T13:00:00Z'));
    expect(late.deliveredKwh).toBeLessThanOrEqual(30);
    expect(late.powerKw).toBe(0);
    const early = simulateSample(base, new Date('2026-11-21T12:00:10Z'));
    expect(early.powerKw).toBeGreaterThan(50);
  });
});
