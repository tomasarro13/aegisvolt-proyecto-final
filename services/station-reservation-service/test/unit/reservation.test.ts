import { InMemoryFeatureFlags, NoopLogger } from '@aegisvolt/shared';
import { describe, expect, it } from 'vitest';
import { ChargingLifecycleUseCase } from '../../src/application/charging-lifecycle.use-case.js';
import { ReleaseReservationUseCase } from '../../src/application/release-reservation.use-case.js';
import { BOOST_HOLD_MINUTES, ReserveConnectorUseCase, STANDARD_HOLD_MINUTES } from '../../src/application/reserve-connector.use-case.js';
import { Connector, type ConnectorSnapshot } from '../../src/domain/connector.js';
import type { ReservationRepository } from '../../src/domain/repositories.js';
import { Reservation, type ReservationSnapshot } from '../../src/domain/reservation.js';

class MemoryRepo implements ReservationRepository {
  connectors = new Map<string, ConnectorSnapshot>();
  reservations = new Map<string, ReservationSnapshot>();
  async findConnector(_s: string, c: string) { const x = this.connectors.get(c); return x ? Connector.fromSnapshot(x) : undefined; }
  async findReservation(id: string) { const r = this.reservations.get(id); return r ? Reservation.fromSnapshot(r) : undefined; }
  async save(r: Reservation, c?: { entity: Connector; expectedVersion: number }) {
    if (c && this.connectors.get(c.entity.id)?.version !== c.expectedVersion) throw new Error('version conflict');
    this.reservations.set(r.sagaId, r.toSnapshot());
    if (c) this.connectors.set(c.entity.id, c.entity.toSnapshot());
  }
}

const now = new Date('2026-11-21T12:00:00Z');
const clock = { now: () => now };
const setup = (flags = new InMemoryFeatureFlags()) => {
  const repo = new MemoryRepo();
  repo.connectors.set('C1', { stationId: 'S1', connectorId: 'C1', type: 'CCS2', powerKw: 150, status: 'AVAILABLE', version: 1, updatedAt: '' });
  return {
    repo,
    reserve: new ReserveConnectorUseCase(repo, flags, clock, new NoopLogger()),
    release: new ReleaseReservationUseCase(repo, clock, new NoopLogger()),
    lifecycle: new ChargingLifecycleUseCase(repo, clock, new NoopLogger()),
  };
};
const cmd = { sagaId: 'saga-1', stationId: 'S1', connectorId: 'C1', fleetId: 'F1', fastChargeBoost: false };

describe('ReserveConnectorUseCase', () => {
  it('cambia el conector a RESERVED con hold estándar', async () => {
    const { reserve, repo } = setup();
    const r = await reserve.execute(cmd);
    expect(repo.connectors.get('C1')).toMatchObject({ status: 'RESERVED', reservedBy: 'saga-1', version: 2 });
    expect(new Date(r.holdUntil).getTime() - now.getTime()).toBe(STANDARD_HOLD_MINUTES * 60_000);
  });

  it('ENABLE_FAST_CHARGE_BOOST otorga reserva prioritaria extendida', async () => {
    const { reserve } = setup(new InMemoryFeatureFlags({ ENABLE_FAST_CHARGE_BOOST: true }));
    const r = await reserve.execute({ ...cmd, fastChargeBoost: true });
    expect(r.priorityBoost).toBe(true);
    expect(new Date(r.holdUntil).getTime() - now.getTime()).toBe(BOOST_HOLD_MINUTES * 60_000);
  });

  it('sin la flag, el boost solicitado se ignora', async () => {
    const { reserve } = setup();
    expect((await reserve.execute({ ...cmd, fastChargeBoost: true })).priorityBoost).toBe(false);
  });

  it('es idempotente para el mismo sagaId', async () => {
    const { reserve, repo } = setup();
    await reserve.execute(cmd);
    await reserve.execute(cmd);
    expect(repo.connectors.get('C1')?.version).toBe(2);
  });

  it('rechaza reservar un conector ocupado por otra SAGA', async () => {
    const { reserve } = setup();
    await reserve.execute(cmd);
    await expect(reserve.execute({ ...cmd, sagaId: 'saga-2' })).rejects.toMatchObject({ code: 'CONNECTOR_UNAVAILABLE' });
  });
});

describe('ReleaseReservationUseCase (compensación)', () => {
  it('libera el conector a AVAILABLE', async () => {
    const { reserve, release, repo } = setup();
    await reserve.execute(cmd);
    const r = await release.execute('saga-1', 'CHARGE_WALLET:INSUFFICIENT_FUNDS');
    expect(r.status).toBe('RELEASED');
    expect(repo.connectors.get('C1')).toMatchObject({ status: 'AVAILABLE', reservedBy: undefined });
  });

  it('procesar la compensación dos veces no tiene efectos adicionales', async () => {
    const { reserve, release, repo } = setup();
    await reserve.execute(cmd);
    await release.execute('saga-1', 'x');
    const versionAfterFirst = repo.connectors.get('C1')?.version;
    await release.execute('saga-1', 'x');
    expect(repo.connectors.get('C1')?.version).toBe(versionAfterFirst);
  });

  it('no libera un conector que ahora pertenece a otra SAGA', async () => {
    const { reserve, release, repo } = setup();
    await reserve.execute(cmd);
    await release.execute('saga-1', 'x');
    await reserve.execute({ ...cmd, sagaId: 'saga-2' });
    await release.execute('saga-1', 'duplicado tardío');
    expect(repo.connectors.get('C1')).toMatchObject({ status: 'RESERVED', reservedBy: 'saga-2' });
  });

  it('compensación antes de la reserva deja tombstone y bloquea la reserva tardía', async () => {
    const { reserve, release } = setup();
    await release.execute('saga-1', 'timeout');
    await expect(reserve.execute(cmd)).rejects.toMatchObject({ code: 'SAGA_ALREADY_COMPENSATED' });
  });

  it('ciclo completo RESERVED -> CHARGING -> AVAILABLE', async () => {
    const { reserve, lifecycle, repo } = setup();
    await reserve.execute(cmd);
    await lifecycle.startCharging('saga-1');
    expect(repo.connectors.get('C1')?.status).toBe('CHARGING');
    await lifecycle.complete('saga-1');
    expect(repo.connectors.get('C1')?.status).toBe('AVAILABLE');
  });
});
