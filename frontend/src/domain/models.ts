/** Modelos de dominio del frontend (independientes de GraphQL, React o Next). */
export type EnvironmentName = 'dev' | 'test' | 'prod';
export type ConnectorStatus = 'AVAILABLE' | 'RESERVED' | 'CHARGING' | 'OUT_OF_SERVICE';
export type SagaStatus = 'STARTED' | 'COMPLETED' | 'FINISHED' | 'FAILED' | 'COMPENSATING' | 'COMPENSATED' | 'COMPENSATION_FAILED';
export type StepStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'COMPENSATED' | 'COMPENSATION_FAILED' | 'SKIPPED';
export type FlagKey = 'ENABLE_DYNAMIC_SURGE_PRICING' | 'ENABLE_FAST_CHARGE_BOOST' | 'SIMULATE_CHARGER_HARDWARE_FAULT';

export interface EnvironmentInfo {
  name: EnvironmentName;
  version: string;
  track: string;
  region: string;
  flagMutationsAllowed: boolean;
  serverTime: string;
}

export interface Connector {
  id: string;
  stationId: string;
  type: string;
  powerKw: number;
  status: ConnectorStatus;
  reservedBy?: string | null;
  reservedUntil?: string | null;
}

export interface Station {
  id: string;
  name: string;
  city: string;
  address: string;
  latitude: number;
  longitude: number;
  availableConnectors: number;
  connectors: Connector[];
}

export interface Wallet {
  fleetId: string;
  fleetName: string;
  balance: number;
  currency: string;
}

export interface FeatureFlag {
  key: FlagKey;
  enabled: boolean;
  description: string;
  environment: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export interface SagaStep {
  name: string;
  service: string;
  status: StepStatus;
  attempts: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  compensatedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface SagaTransaction {
  id: string;
  status: SagaStatus;
  environment: string;
  fleetId: string;
  stationId: string;
  connectorId: string;
  estimatedKwh: number;
  chargedAmount?: number | null;
  currency?: string | null;
  pricingStrategy?: string | null;
  surgeMultiplier?: number | null;
  priorityBoost?: boolean | null;
  compensated: boolean;
  prefectRunUrl?: string | null;
  failure?: { step: string; code: string; message: string } | null;
  steps: SagaStep[];
  createdAt: string;
  updatedAt: string;
}

export interface PriceQuote {
  estimatedKwh: number;
  baseRatePerKwh: number;
  surgeMultiplier: number;
  boostMultiplier: number;
  total: number;
  currency: string;
  strategy: string;
}

export interface ChargingSession {
  sagaId: string;
  stationId: string;
  connectorId: string;
  fleetId: string;
  powerKw: number;
  targetKwh: number;
  deliveredKwh: number;
  status: string;
  startedAt: string;
}

export interface TelemetrySample {
  at: string;
  powerKw: number;
  deliveredKwh: number;
  voltageV: number;
  currentA: number;
  temperatureC: number;
}

export interface ServiceHealth {
  service: string;
  status: string;
  latencyMs: number;
}

export interface ReserveInput {
  fleetId: string;
  stationId: string;
  connectorId: string;
  estimatedKwh: number;
  fastChargeBoost: boolean;
}
