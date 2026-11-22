import { asyncHandler, ValidationError } from '@aegisvolt/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { ChargingLifecycleUseCase } from '../../application/charging-lifecycle.use-case.js';
import type { ReleaseReservationUseCase } from '../../application/release-reservation.use-case.js';
import type { ReserveConnectorUseCase } from '../../application/reserve-connector.use-case.js';
import type { StationQueries } from '../../application/station-queries.js';

const reserveSchema = z.object({
  sagaId: z.string().min(1),
  stationId: z.string().min(1),
  connectorId: z.string().min(1),
  fleetId: z.string().min(1),
  fastChargeBoost: z.boolean().default(false),
});

const releaseSchema = z.object({ reason: z.string().default('SAGA_COMPENSATION') });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new ValidationError('Solicitud inválida', { issues: result.error.issues });
  return result.data;
}

export interface StationControllers {
  reserve: ReserveConnectorUseCase;
  release: ReleaseReservationUseCase;
  lifecycle: ChargingLifecycleUseCase;
  queries: StationQueries;
}

/** Adaptador de entrada HTTP: valida, delega en el caso de uso y serializa. Sin lógica de negocio. */
export function stationRoutes(uc: StationControllers): Router {
  const router = Router();

  router.get('/stations', asyncHandler(async (req, res) => {
    res.json(await uc.queries.list(typeof req.query.city === 'string' ? req.query.city : undefined));
  }));
  router.get('/stations/:stationId', asyncHandler(async (req, res) => {
    res.json(await uc.queries.get(String(req.params.stationId)));
  }));
  router.post('/reservations', asyncHandler(async (req, res) => {
    res.status(201).json(await uc.reserve.execute(parse(reserveSchema, req.body)));
  }));
  router.post('/reservations/:sagaId/release', asyncHandler(async (req, res) => {
    const { reason } = parse(releaseSchema, req.body ?? {});
    res.json(await uc.release.execute(String(req.params.sagaId), reason));
  }));
  router.post('/reservations/:sagaId/start-charging', asyncHandler(async (req, res) => {
    res.json(await uc.lifecycle.startCharging(String(req.params.sagaId)));
  }));
  router.post('/reservations/:sagaId/complete', asyncHandler(async (req, res) => {
    res.json(await uc.lifecycle.complete(String(req.params.sagaId)));
  }));
  return router;
}
