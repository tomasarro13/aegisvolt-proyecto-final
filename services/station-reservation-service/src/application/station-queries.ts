import { NotFoundError } from '@aegisvolt/shared';
import type { StationQueryRepository } from '../domain/repositories.js';
import type { StationView } from '../domain/station.js';

/** Lado de consulta (CQRS ligero): no pasa por las entidades, solo lee vistas. */
export class StationQueries {
  constructor(private readonly repository: StationQueryRepository) {}

  list(city?: string): Promise<StationView[]> {
    return this.repository.listStations(city);
  }

  async get(stationId: string): Promise<StationView> {
    const station = await this.repository.getStation(stationId);
    if (!station) throw new NotFoundError('Station', stationId);
    return station;
  }
}
