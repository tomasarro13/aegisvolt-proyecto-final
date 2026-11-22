import type { Connector } from './connector.js';
import type { Reservation } from './reservation.js';
import type { StationView } from './station.js';

/**
 * Puerto de persistencia del agregado reserva. `save` debe ser atómico (conector + reserva)
 * y usar control de concurrencia optimista sobre la versión del conector.
 */
export interface ReservationRepository {
  findConnector(stationId: string, connectorId: string): Promise<Connector | undefined>;
  findReservation(sagaId: string): Promise<Reservation | undefined>;
  save(reservation: Reservation, connector?: { entity: Connector; expectedVersion: number }): Promise<void>;
}

export interface StationQueryRepository {
  listStations(city?: string): Promise<StationView[]>;
  getStation(stationId: string): Promise<StationView | undefined>;
}
