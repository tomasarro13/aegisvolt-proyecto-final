import type {
  ChargingSession, EnvironmentInfo, EnvironmentName, FeatureFlag, FlagKey, PriceQuote, ReserveInput, SagaTransaction,
  ServiceHealth, Station, TelemetrySample, Wallet,
} from '@/domain/models';

/** Puerto de acceso al backend: la UI no conoce GraphQL ni HTTP (DIP). */
export interface AegisVoltApi {
  overview(): Promise<{ environment: EnvironmentInfo; stations: Station[]; wallets: Wallet[]; featureFlags: FeatureFlag[]; health: ServiceHealth[] }>;
  sagas(limit?: number): Promise<SagaTransaction[]>;
  sessions(): Promise<ChargingSession[]>;
  telemetry(sagaId: string): Promise<TelemetrySample[]>;
  quote(estimatedKwh: number, powerKw: number, boost: boolean): Promise<PriceQuote>;
  reserveAndActivate(input: ReserveInput): Promise<SagaTransaction>;
  stopSession(sagaId: string): Promise<SagaTransaction>;
  setFlag(key: FlagKey, enabled: boolean): Promise<FeatureFlag>;
  topUp(fleetId: string, amount: number): Promise<Wallet>;
}

export type ApiFactory = (env: EnvironmentName) => AegisVoltApi;
