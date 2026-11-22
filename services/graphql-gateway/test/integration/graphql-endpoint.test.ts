import { AppError, InMemoryFeatureFlags, NoopLogger } from '@aegisvolt/shared';
import { createSchema, createYoga } from 'graphql-yoga';
import { describe, expect, it } from 'vitest';
import type { ChargingSagaContext } from '../../src/application/charging-saga-context.js';
import { DashboardQueries, FeatureFlagAdminUseCase } from '../../src/application/dashboard-queries.js';
import type { BillingPort, DispatchPort, StationPort } from '../../src/application/ports.js';
import { StartChargingSagaUseCase } from '../../src/application/start-charging-saga.use-case.js';
import { ActivateChargerStep, ChargeWalletStep, ConfirmChargingStep, ReserveConnectorStep } from '../../src/application/steps/charging-steps.js';
import { StopChargingSessionUseCase } from '../../src/application/stop-charging-session.use-case.js';
import type { SagaSnapshot } from '../../src/domain/saga.js';
import { buildResolvers } from '../../src/interfaces/graphql/resolvers.js';
import { loadTypeDefs } from '../../src/interfaces/graphql/server.js';

type Ctx = ChargingSagaContext & { sagaId: string };
const calls: string[] = [];
const station = { stationId: 'S1', name: 'S', city: 'Bogotá', address: '', latitude: 0, longitude: 0, connectors: [{ stationId: 'S1', connectorId: 'C1', type: 'CCS2', powerKw: 60, status: 'AVAILABLE', updatedAt: '' }] };
const stations: StationPort = {
  listStations: async () => [station], getStation: async () => station,
  reserve: async (i) => { calls.push('reserve'); return { ...i, status: 'RESERVED', priorityBoost: false, holdUntil: '' }; },
  release: async (id) => { calls.push('release'); return { sagaId: id } as never; },
  startCharging: async (id) => { calls.push('start'); return { sagaId: id } as never; },
  complete: async (id) => ({ sagaId: id }) as never,
};
const flags = new InMemoryFeatureFlags();
const billing: BillingPort = {
  listWallets: async () => [], getWallet: async () => ({}) as never, topUp: async () => ({}) as never, quote: async () => ({}) as never,
  charge: async (i) => { calls.push('charge'); return { sagaId: i.sagaId, fleetId: i.fleetId, amount: 1000, currency: 'COP', status: 'CHARGED', quote: { strategy: 'STANDARD', surgeMultiplier: 1 } as never }; },
  refund: async () => { calls.push('refund'); return { refunded: true }; },
};
const dispatch: DispatchPort = {
  activate: async () => {
    calls.push('activate');
    if (await flags.isEnabled('SIMULATE_CHARGER_HARDWARE_FAULT')) throw new AppError('CHARGER_HARDWARE_FAULT', 'falla', 409);
    return { startedAt: new Date().toISOString() } as never;
  },
  stop: async () => ({}) as never, listSessions: async () => [], telemetry: async () => [],
};
const store = new Map<string, SagaSnapshot<Ctx>>();
const sagas = { save: async (s: SagaSnapshot<Ctx>) => { store.set(s.sagaId, s); }, find: async (id: string) => store.get(id), list: async () => [...store.values()] };
let n = 0;
const logger = new NoopLogger();
const clock = { now: () => new Date() };

const yoga = createYoga({
  schema: createSchema({
    typeDefs: loadTypeDefs(),
    resolvers: buildResolvers({
      queries: new DashboardQueries(stations, billing, dispatch, sagas, []),
      flags: new FeatureFlagAdminUseCase(flags, true, logger),
      startSaga: new StartChargingSagaUseCase(stations, [new ReserveConnectorStep(stations), new ChargeWalletStep(billing), new ActivateChargerStep(dispatch), new ConfirmChargingStep(stations)], sagas, { next: () => `saga-${++n}` }, clock, logger, 'test'),
      stopSession: new StopChargingSessionUseCase(sagas, dispatch, stations, clock, logger),
      environment: { name: 'test', version: 'it', track: 'stable', region: 'us-east-1', flagMutationsAllowed: true },
    }),
  }),
  logging: false,
});

async function exec(query: string) {
  const res = await yoga.fetch('http://test/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  return (await res.json()) as { data: any; errors?: any[] };
}

describe('endpoint GraphQL (schema + resolvers + casos de uso)', () => {
  it('query stations agrega disponibilidad', async () => {
    const r = await exec('{ environment { name } stations { id availableConnectors connectors { id status } } }');
    expect(r.data.environment.name).toBe('test');
    expect(r.data.stations[0]).toMatchObject({ id: 'S1', availableConnectors: 1 });
  });

  it('mutation reserveAndActivateCharging -> COMPLETED', async () => {
    calls.length = 0;
    const r = await exec('mutation { reserveAndActivateCharging(input:{fleetId:"F", stationId:"S1", connectorId:"C1", estimatedKwh:10}) { status steps { status } } }');
    expect(r.data.reserveAndActivateCharging.status).toBe('COMPLETED');
    expect(calls).toEqual(['reserve', 'charge', 'activate', 'start']);
  });

  it('setFeatureFlag + falla física => compensaciones refund y release vía GraphQL', async () => {
    await exec('mutation { setFeatureFlag(key: SIMULATE_CHARGER_HARDWARE_FAULT, enabled: true) { enabled } }');
    calls.length = 0;
    const r = await exec('mutation { reserveAndActivateCharging(input:{fleetId:"F", stationId:"S1", connectorId:"C1", estimatedKwh:10}) { status compensated failure { code } } }');
    expect(r.data.reserveAndActivateCharging).toMatchObject({ status: 'COMPENSATED', compensated: true, failure: { code: 'CHARGER_HARDWARE_FAULT' } });
    expect(calls).toEqual(['reserve', 'charge', 'activate', 'refund', 'release']);
  });

  it('errores de validación se exponen con extensions.code', async () => {
    const r = await exec('mutation { reserveAndActivateCharging(input:{fleetId:"F", stationId:"S1", connectorId:"C1", estimatedKwh:9999}) { id } }');
    expect(r.errors?.[0].extensions.code).toBe('VALIDATION_ERROR');
  });
});
