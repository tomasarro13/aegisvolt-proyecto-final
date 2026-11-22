import { AppError, type FlagKey } from '@aegisvolt/shared';
import { createGraphQLError } from 'graphql-yoga';
import type { ChargingSagaContext } from '../../application/charging-saga-context.js';
import type { DashboardQueries, FeatureFlagAdminUseCase } from '../../application/dashboard-queries.js';
import type { StationDto } from '../../application/ports.js';
import type { StartChargingInput, StartChargingSagaUseCase } from '../../application/start-charging-saga.use-case.js';
import type { StopChargingSessionUseCase } from '../../application/stop-charging-session.use-case.js';
import type { SagaSnapshot } from '../../domain/saga.js';

export interface ResolverDeps {
  queries: DashboardQueries;
  flags: FeatureFlagAdminUseCase;
  startSaga: StartChargingSagaUseCase;
  stopSession: StopChargingSessionUseCase;
  environment: { name: string; version: string; track: string; region: string; flagMutationsAllowed: boolean };
}

type SagaView = SagaSnapshot<ChargingSagaContext & { sagaId: string }>;

/** Traduce errores de aplicación a errores GraphQL con `extensions.code` estable. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (err) {
    if (err instanceof AppError) throw createGraphQLError(err.message, { extensions: { code: err.code, details: err.details } });
    throw err;
  }
}

const toStation = (s: StationDto) => ({
  id: s.stationId, name: s.name, city: s.city, address: s.address, latitude: s.latitude, longitude: s.longitude,
  availableConnectors: s.connectors.filter((c) => c.status === 'AVAILABLE').length,
  connectors: s.connectors.map((c) => ({ ...c, id: c.connectorId })),
});

const toSaga = (s: SagaView) => ({
  id: s.sagaId,
  type: s.type,
  environment: s.environment,
  status: s.status,
  fleetId: s.context.fleetId,
  stationId: s.context.stationId,
  connectorId: s.context.connectorId,
  estimatedKwh: s.context.estimatedKwh,
  chargedAmount: s.context.chargedAmount,
  currency: s.context.currency,
  pricingStrategy: s.context.pricingStrategy,
  surgeMultiplier: s.context.surgeMultiplier,
  priorityBoost: s.context.priorityBoost,
  steps: s.steps.map((st) => ({ ...st, errorCode: st.error?.code, errorMessage: st.error?.message })),
  failure: s.failure,
  compensated: s.steps.some((st) => st.status === 'COMPENSATED'),
  prefectRunUrl: s.observabilityUrl,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

/** Adaptador de entrada GraphQL: los resolvers solo delegan en casos de uso (SRP). */
export function buildResolvers(deps: ResolverDeps) {
  const { queries, flags } = deps;
  return {
    Query: {
      environment: () => ({ ...deps.environment, serverTime: new Date().toISOString() }),
      systemHealth: () => queries.systemHealth(),
      stations: (_: unknown, a: { city?: string }) => guard(async () => (await queries.stations.listStations(a.city)).map(toStation)),
      station: (_: unknown, a: { id: string }) => guard(async () => toStation(await queries.stations.getStation(a.id))),
      wallets: () => guard(async () => (await queries.billing.listWallets()).map((w) => ({ ...w, ledger: [] }))),
      wallet: (_: unknown, a: { fleetId: string }) => guard(async () => {
        const w = await queries.billing.getWallet(a.fleetId);
        return { ...w, ledger: w.ledger ?? [] };
      }),
      featureFlags: () => guard(() => flags.list()),
      priceQuote: (_: unknown, a: { estimatedKwh: number; powerKw: number; fastChargeBoost: boolean }) =>
        guard(() => queries.billing.quote(a.estimatedKwh, a.powerKw, a.fastChargeBoost)),
      sagas: (_: unknown, a: { limit: number }) => guard(async () => (await queries.sagas.list(Math.min(a.limit, 100))).map(toSaga)),
      saga: (_: unknown, a: { id: string }) => guard(async () => {
        const s = await queries.sagas.find(a.id);
        return s ? toSaga(s) : null;
      }),
      chargingSessions: (_: unknown, a: { limit: number }) => guard(() => queries.dispatch.listSessions(Math.min(a.limit, 100))),
      telemetry: (_: unknown, a: { sagaId: string; limit: number }) => guard(() => queries.dispatch.telemetry(a.sagaId, Math.min(a.limit, 500))),
    },
    Mutation: {
      reserveAndActivateCharging: (_: unknown, a: { input: StartChargingInput }) => guard(async () => toSaga(await deps.startSaga.execute(a.input))),
      stopChargingSession: (_: unknown, a: { sagaId: string }) => guard(async () => toSaga(await deps.stopSession.execute(a.sagaId))),
      setFeatureFlag: (_: unknown, a: { key: FlagKey; enabled: boolean }) => guard(() => flags.set(a.key, a.enabled, 'graphql-panel')),
      topUpWallet: (_: unknown, a: { fleetId: string; amount: number }) => guard(async () => ({ ...(await queries.billing.topUp(a.fleetId, a.amount)), ledger: [] })),
    },
  };
}
