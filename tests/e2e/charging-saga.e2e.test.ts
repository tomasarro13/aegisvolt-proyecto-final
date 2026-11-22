/**
 * E2E: Frontend (BFF Next.js) -> API Gateway -> GraphQL -> microservicios -> DynamoDB.
 * Valida el flujo completo de la SAGA, sus compensaciones y el aislamiento de feature flags.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ENV = process.env.E2E_ENVIRONMENT ?? 'dev';
const FRONTEND = process.env.E2E_FRONTEND_URL ?? 'http://localhost:3100';
const API = process.env.E2E_GRAPHQL_URL ?? 'http://localhost:4000/graphql';

async function gql<T = any>(query: string, variables?: Record<string, unknown>, via: 'frontend' | 'api' = 'frontend'): Promise<T> {
  const url = via === 'frontend' ? `${FRONTEND}/api/graphql/${ENV}` : API;
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors[0]!.message);
  return body.data as T;
}

const SAGA = `id status chargedAmount failure { step code } steps { name status }`;
const reserve = (input: Record<string, unknown>) =>
  gql<{ reserveAndActivateCharging: any }>(`mutation($i: ReserveAndActivateInput!){ reserveAndActivateCharging(input:$i){ ${SAGA} } }`, { i: input }).then((d) => d.reserveAndActivateCharging);
const setFlag = (key: string, enabled: boolean) => gql(`mutation{ setFeatureFlag(key:${key}, enabled:${enabled}){ key enabled } }`);
const wallet = async (id: string) => (await gql<{ wallet: { balance: number } }>(`{ wallet(fleetId:"${id}"){ balance } }`)).wallet.balance;
const connector = async (stationId: string, id: string) =>
  (await gql<{ station: { connectors: { id: string; status: string }[] } }>(`{ station(id:"${stationId}"){ connectors { id status } } }`)).station.connectors.find((c) => c.id === id)!.status;

async function freeConnector(): Promise<{ stationId: string; connectorId: string }> {
  const { stations } = await gql<{ stations: { id: string; connectors: { id: string; status: string }[] }[] }>('{ stations { id connectors { id status } } }');
  for (const s of stations) for (const c of s.connectors) if (c.status === 'AVAILABLE') return { stationId: s.id, connectorId: c.id };
  throw new Error('no hay conectores libres');
}

describe(`E2E SAGA (${ENV})`, () => {
  beforeAll(async () => { await setFlag('SIMULATE_CHARGER_HARDWARE_FAULT', false); });
  afterAll(async () => { await setFlag('SIMULATE_CHARGER_HARDWARE_FAULT', false); });

  it('el frontend y el API Gateway responden el mismo ambiente', async () => {
    const viaFrontend = await gql<{ environment: { name: string } }>('{ environment { name } }');
    const viaApi = await gql<{ environment: { name: string } }>('{ environment { name } }', undefined, 'api');
    expect(viaFrontend.environment.name).toBe(ENV);
    expect(viaApi.environment.name).toBe(ENV);
  });

  it('flujo feliz: reserva -> cobro -> activación -> COMPLETED; luego fin de sesión libera el conector', async () => {
    const target = await freeConnector();
    const before = await wallet('FLEET-ANDES');
    const saga = await reserve({ fleetId: 'FLEET-ANDES', ...target, estimatedKwh: 10 });
    expect(saga.status).toBe('COMPLETED');
    expect(await wallet('FLEET-ANDES')).toBe(before - saga.chargedAmount);
    expect(await connector(target.stationId, target.connectorId)).toBe('CHARGING');
    const stopped = await gql<{ stopChargingSession: { status: string } }>(`mutation{ stopChargingSession(sagaId:"${saga.id}"){ status } }`);
    expect(stopped.stopChargingSession.status).toBe('FINISHED');
    expect(await connector(target.stationId, target.connectorId)).toBe('AVAILABLE');
  });

  it('paso 2 falla (fondos insuficientes) => se libera el conector', async () => {
    const target = await freeConnector();
    const saga = await reserve({ fleetId: 'FLEET-COLIBRI', ...target, estimatedKwh: 100 });
    expect(saga.status).toBe('COMPENSATED');
    expect(saga.failure).toMatchObject({ step: 'CHARGE_WALLET', code: 'INSUFFICIENT_FUNDS' });
    expect(saga.steps.map((s: any) => s.status)).toEqual(['COMPENSATED', 'FAILED', 'SKIPPED', 'SKIPPED']);
    expect(await connector(target.stationId, target.connectorId)).toBe('AVAILABLE');
  });

  it('paso 3 falla (SIMULATE_CHARGER_HARDWARE_FAULT) => reembolso y luego liberación del conector, sin redesplegar', async () => {
    await setFlag('SIMULATE_CHARGER_HARDWARE_FAULT', true);
    await new Promise((r) => setTimeout(r, 2500)); // TTL de caché de flags
    const target = await freeConnector();
    const before = await wallet('FLEET-CONDOR');
    const saga = await reserve({ fleetId: 'FLEET-CONDOR', ...target, estimatedKwh: 10 });
    expect(saga.status).toBe('COMPENSATED');
    expect(saga.failure).toMatchObject({ step: 'ACTIVATE_CHARGER', code: 'CHARGER_HARDWARE_FAULT' });
    expect(saga.steps.map((s: any) => s.status)).toEqual(['COMPENSATED', 'COMPENSATED', 'FAILED', 'SKIPPED']);
    expect(await wallet('FLEET-CONDOR')).toBe(before);
    expect(await connector(target.stationId, target.connectorId)).toBe('AVAILABLE');
  });

  it('idempotencia de cliente: la misma idempotencyKey devuelve la misma SAGA', async () => {
    await setFlag('SIMULATE_CHARGER_HARDWARE_FAULT', false);
    await new Promise((r) => setTimeout(r, 2500));
    const target = await freeConnector();
    const key = `e2e-${Date.now()}`;
    const a = await reserve({ fleetId: 'FLEET-COLIBRI', ...target, estimatedKwh: 100, idempotencyKey: key });
    const b = await reserve({ fleetId: 'FLEET-COLIBRI', ...target, estimatedKwh: 100, idempotencyKey: key });
    expect(b.id).toBe(a.id);
  });
});
