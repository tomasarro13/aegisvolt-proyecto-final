/**
 * Puertos de salida hacia los microservicios. El orquestador depende de estas interfaces
 * (DIP); la implementación HTTP vive en infrastructure/. ISP: cada puerto expone solo lo que
 * el gateway necesita de ese servicio.
 */
export interface ConnectorDto {
  stationId: string;
  connectorId: string;
  type: string;
  powerKw: number;
  status: string;
  reservedBy?: string;
  reservedUntil?: string;
  updatedAt: string;
}

export interface StationDto {
  stationId: string;
  name: string;
  city: string;
  address: string;
  latitude: number;
  longitude: number;
  connectors: ConnectorDto[];
}

export interface ReservationDto {
  sagaId: string;
  stationId: string;
  connectorId: string;
  fleetId: string;
  status: string;
  priorityBoost: boolean;
  holdUntil: string;
}

export interface StationPort {
  listStations(city?: string): Promise<StationDto[]>;
  getStation(stationId: string): Promise<StationDto>;
  reserve(input: { sagaId: string; stationId: string; connectorId: string; fleetId: string; fastChargeBoost: boolean }): Promise<ReservationDto>;
  release(sagaId: string, reason: string): Promise<ReservationDto>;
  startCharging(sagaId: string): Promise<ReservationDto>;
  complete(sagaId: string): Promise<ReservationDto>;
}

export interface PriceQuoteDto {
  estimatedKwh: number;
  baseRatePerKwh: number;
  surgeMultiplier: number;
  boostMultiplier: number;
  total: number;
  currency: string;
  strategy: string;
}

export interface ChargeDto {
  sagaId: string;
  fleetId: string;
  amount: number;
  currency: string;
  status: string;
  quote: PriceQuoteDto;
}

export interface LedgerEventDto {
  fleetId: string;
  sagaId?: string;
  type: string;
  amount: number;
  balanceAfter: number;
  reason?: string;
  at: string;
}

export interface WalletDto {
  fleetId: string;
  fleetName: string;
  balance: number;
  currency: string;
  updatedAt: string;
  ledger?: LedgerEventDto[];
}

export interface BillingPort {
  listWallets(): Promise<WalletDto[]>;
  getWallet(fleetId: string): Promise<WalletDto>;
  topUp(fleetId: string, amount: number): Promise<WalletDto>;
  quote(estimatedKwh: number, powerKw: number, boost: boolean): Promise<PriceQuoteDto>;
  charge(input: { sagaId: string; fleetId: string; estimatedKwh: number; powerKw: number; priorityBoost: boolean }): Promise<ChargeDto>;
  refund(sagaId: string, reason: string): Promise<{ refunded: boolean }>;
}

export interface ChargingSessionDto {
  sagaId: string;
  stationId: string;
  connectorId: string;
  fleetId: string;
  powerKw: number;
  targetKwh: number;
  deliveredKwh: number;
  status: string;
  failureReason?: string;
  startedAt: string;
  stoppedAt?: string;
}

export interface TelemetryDto {
  sagaId: string;
  connectorId: string;
  at: string;
  powerKw: number;
  deliveredKwh: number;
  voltageV: number;
  currentA: number;
  temperatureC: number;
}

export interface DispatchPort {
  activate(input: { sagaId: string; stationId: string; connectorId: string; fleetId: string; powerKw: number; targetKwh: number }): Promise<ChargingSessionDto>;
  stop(sagaId: string): Promise<ChargingSessionDto>;
  listSessions(limit: number): Promise<ChargingSessionDto[]>;
  telemetry(sagaId: string, limit: number): Promise<TelemetryDto[]>;
}

export interface HealthPort {
  name: string;
  check(): Promise<{ status: string; latencyMs: number; detail?: string }>;
}

export interface Clock { now(): Date }
export interface IdGenerator { next(): string }
