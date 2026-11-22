import type { ConnectorSnapshot } from './connector.js';

export interface StationInfo {
  stationId: string;
  name: string;
  city: string;
  address: string;
  latitude: number;
  longitude: number;
}

/** Vista de lectura: estación con sus conectores. */
export interface StationView extends StationInfo {
  connectors: ConnectorSnapshot[];
}
