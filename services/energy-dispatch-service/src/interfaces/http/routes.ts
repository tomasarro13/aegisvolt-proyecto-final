import { asyncHandler, ValidationError } from '@aegisvolt/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { ActivateChargerUseCase } from '../../application/activate-charger.use-case.js';
import type { SessionService } from '../../application/session-service.js';

const activateSchema = z.object({
  sagaId: z.string().min(1),
  stationId: z.string().min(1),
  connectorId: z.string().min(1),
  fleetId: z.string().min(1),
  powerKw: z.number().positive(),
  targetKwh: z.number().positive(),
});

export function dispatchRoutes(uc: { activate: ActivateChargerUseCase; sessions: SessionService }): Router {
  const router = Router();
  router.post('/sessions', asyncHandler(async (req, res) => {
    const parsed = activateSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Solicitud inválida', { issues: parsed.error.issues });
    res.status(201).json(await uc.activate.execute(parsed.data));
  }));
  router.get('/sessions', asyncHandler(async (req, res) => { res.json(await uc.sessions.list(Number(req.query.limit ?? 25))); }));
  router.get('/sessions/:sagaId', asyncHandler(async (req, res) => { res.json(await uc.sessions.get(String(req.params.sagaId))); }));
  router.get('/sessions/:sagaId/telemetry', asyncHandler(async (req, res) => {
    res.json(await uc.sessions.telemetry(String(req.params.sagaId), Number(req.query.limit ?? 60)));
  }));
  router.post('/sessions/:sagaId/stop', asyncHandler(async (req, res) => { res.json(await uc.sessions.stop(String(req.params.sagaId))); }));
  return router;
}
