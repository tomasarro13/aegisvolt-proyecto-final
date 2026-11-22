import { HttpClient } from '@aegisvolt/shared';
import type {
  BillingPort, ChargeDto, ChargingSessionDto, DispatchPort, HealthPort, PriceQuoteDto, ReservationDto, StationDto, StationPort, TelemetryDto, WalletDto,
} from '../application/ports.js';

const enc = encodeURIComponent;

/** Adaptadores HTTP (salida) que implementan los puertos del gateway. */
export class StationHttpAdapter implements StationPort {
  constructor(private readonly http: HttpClient) {}
  listStations(city?: string) { return this.http.get<StationDto[]>(`/stations${city ? `?city=${enc(city)}` : ''}`); }
  getStation(id: string) { return this.http.get<StationDto>(`/stations/${enc(id)}`); }
  reserve(input: Parameters<StationPort['reserve']>[0]) { return this.http.post<ReservationDto>('/reservations', input); }
  release(sagaId: string, reason: string) { return this.http.post<ReservationDto>(`/reservations/${enc(sagaId)}/release`, { reason }); }
  startCharging(sagaId: string) { return this.http.post<ReservationDto>(`/reservations/${enc(sagaId)}/start-charging`); }
  complete(sagaId: string) { return this.http.post<ReservationDto>(`/reservations/${enc(sagaId)}/complete`); }
}

export class BillingHttpAdapter implements BillingPort {
  constructor(private readonly http: HttpClient) {}
  listWallets() { return this.http.get<WalletDto[]>('/wallets'); }
  getWallet(fleetId: string) { return this.http.get<WalletDto>(`/wallets/${enc(fleetId)}`); }
  topUp(fleetId: string, amount: number) { return this.http.post<WalletDto>(`/wallets/${enc(fleetId)}/top-up`, { amount }); }
  quote(kwh: number, powerKw: number, boost: boolean) { return this.http.get<PriceQuoteDto>(`/pricing/quote?kwh=${kwh}&powerKw=${powerKw}&boost=${boost}`); }
  charge(input: Parameters<BillingPort['charge']>[0]) { return this.http.post<ChargeDto>('/charges', input); }
  refund(sagaId: string, reason: string) { return this.http.post<{ refunded: boolean }>(`/charges/${enc(sagaId)}/refund`, { reason }); }
}

export class DispatchHttpAdapter implements DispatchPort {
  constructor(private readonly http: HttpClient) {}
  activate(input: Parameters<DispatchPort['activate']>[0]) { return this.http.post<ChargingSessionDto>('/sessions', input); }
  stop(sagaId: string) { return this.http.post<ChargingSessionDto>(`/sessions/${enc(sagaId)}/stop`); }
  listSessions(limit: number) { return this.http.get<ChargingSessionDto[]>(`/sessions?limit=${limit}`); }
  telemetry(sagaId: string, limit: number) { return this.http.get<TelemetryDto[]>(`/sessions/${enc(sagaId)}/telemetry?limit=${limit}`); }
}

export class HttpHealthCheck implements HealthPort {
  constructor(readonly name: string, private readonly baseUrl: string) {}
  async check() {
    const started = performance.now();
    const res = await fetch(`${this.baseUrl}/health/ready`, { signal: AbortSignal.timeout(2000) });
    const body = (await res.json().catch(() => ({}))) as { status?: string };
    return { status: res.ok ? 'UP' : 'DOWN', latencyMs: Math.round(performance.now() - started), detail: body.status };
  }
}
