import type { AegisVoltApi } from '@/application/ports';
import type { EnvironmentName } from '@/domain/models';

export class GraphQLRequestError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

const SAGA_FIELDS = `id status environment fleetId stationId connectorId estimatedKwh chargedAmount currency pricingStrategy surgeMultiplier
  priorityBoost compensated prefectRunUrl createdAt updatedAt failure { step code message }
  steps { name service status attempts startedAt finishedAt compensatedAt errorCode errorMessage }`;

/** Adaptador GraphQL del puerto AegisVoltApi. Habla con /api/graphql/<env> (proxy hacia el API Gateway). */
export class GraphQLAegisVoltApi implements AegisVoltApi {
  constructor(private readonly env: EnvironmentName) {}

  private async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    // Nombre de la operación en la URL => en la pestaña Red se ve "dev?op=Overview", "dev?op=ReserveAndActivate"...
    const op = /^\s*(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? 'anonymous';
    const res = await fetch(`/api/graphql/${this.env}?op=${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
    if (body.errors?.length) throw new GraphQLRequestError(body.errors[0]!.message, body.errors[0]!.extensions?.code);
    if (!res.ok || !body.data) throw new GraphQLRequestError(`HTTP ${res.status}`);
    return body.data;
  }

  async overview() {
    const d = await this.request<any>(`query Overview {
      environment { name version track region flagMutationsAllowed serverTime }
      stations { id name city address latitude longitude availableConnectors connectors { id stationId type powerKw status reservedBy reservedUntil } }
      wallets { fleetId fleetName balance currency }
      featureFlags { key enabled description environment updatedAt updatedBy }
      systemHealth { service status latencyMs }
    }`);
    return { environment: d.environment, stations: d.stations, wallets: d.wallets, featureFlags: d.featureFlags, health: d.systemHealth };
  }

  async sagas(limit = 25) {
    return (await this.request<any>(`query Sagas($limit:Int){ sagas(limit:$limit){ ${SAGA_FIELDS} } }`, { limit })).sagas;
  }

  async sessions() {
    return (await this.request<any>(`query ChargingSessions { chargingSessions(limit: 10) { sagaId stationId connectorId fleetId powerKw targetKwh deliveredKwh status startedAt } }`)).chargingSessions;
  }

  async telemetry(sagaId: string) {
    return (await this.request<any>(`query Telemetry($id:ID!){ telemetry(sagaId:$id, limit: 60){ at powerKw deliveredKwh voltageV currentA temperatureC } }`, { id: sagaId })).telemetry;
  }

  async quote(estimatedKwh: number, powerKw: number, boost: boolean) {
    return (await this.request<any>(`query PriceQuote($k:Float!,$p:Float!,$b:Boolean){ priceQuote(estimatedKwh:$k, powerKw:$p, fastChargeBoost:$b){ estimatedKwh baseRatePerKwh surgeMultiplier boostMultiplier total currency strategy } }`, { k: estimatedKwh, p: powerKw, b: boost })).priceQuote;
  }

  async reserveAndActivate(input: Parameters<AegisVoltApi['reserveAndActivate']>[0]) {
    return (await this.request<any>(`mutation ReserveAndActivate($input: ReserveAndActivateInput!){ reserveAndActivateCharging(input:$input){ ${SAGA_FIELDS} } }`, { input })).reserveAndActivateCharging;
  }

  async stopSession(sagaId: string) {
    return (await this.request<any>(`mutation StopChargingSession($id:ID!){ stopChargingSession(sagaId:$id){ ${SAGA_FIELDS} } }`, { id: sagaId })).stopChargingSession;
  }

  async setFlag(key: string, enabled: boolean) {
    return (await this.request<any>(`mutation SetFeatureFlag($k:FlagKey!,$e:Boolean!){ setFeatureFlag(key:$k, enabled:$e){ key enabled description environment updatedAt updatedBy } }`, { k: key, e: enabled })).setFeatureFlag;
  }

  async topUp(fleetId: string, amount: number) {
    return (await this.request<any>(`mutation TopUpWallet($f:ID!,$a:Float!){ topUpWallet(fleetId:$f, amount:$a){ fleetId fleetName balance currency } }`, { f: fleetId, a: amount })).topUpWallet;
  }
}
