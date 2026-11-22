import { asyncHandler, ValidationError } from '@aegisvolt/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { ChargeWalletUseCase } from '../../application/charge-wallet.use-case.js';
import type { RefundChargeUseCase } from '../../application/refund-charge.use-case.js';
import type { WalletService } from '../../application/wallet-queries.js';

const chargeSchema = z.object({
  sagaId: z.string().min(1),
  fleetId: z.string().min(1),
  estimatedKwh: z.number().positive().max(500),
  powerKw: z.number().positive(),
  priorityBoost: z.boolean().default(false),
});
const refundSchema = z.object({ reason: z.string().default('SAGA_COMPENSATION') });
const topUpSchema = z.object({ amount: z.number().positive() });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new ValidationError('Solicitud inválida', { issues: r.error.issues });
  return r.data;
}

export function billingRoutes(uc: { charge: ChargeWalletUseCase; refund: RefundChargeUseCase; wallets: WalletService }): Router {
  const router = Router();
  router.get('/wallets', asyncHandler(async (_req, res) => { res.json(await uc.wallets.list()); }));
  router.get('/wallets/:fleetId', asyncHandler(async (req, res) => { res.json(await uc.wallets.get(String(req.params.fleetId))); }));
  router.post('/wallets/:fleetId/top-up', asyncHandler(async (req, res) => {
    res.json(await uc.wallets.topUp(String(req.params.fleetId), parse(topUpSchema, req.body).amount));
  }));
  router.get('/pricing/quote', asyncHandler(async (req, res) => {
    res.json(await uc.wallets.quote(Number(req.query.kwh ?? 20), Number(req.query.powerKw ?? 50), req.query.boost === 'true'));
  }));
  router.post('/charges', asyncHandler(async (req, res) => { res.status(201).json(await uc.charge.execute(parse(chargeSchema, req.body))); }));
  router.get('/charges/:sagaId', asyncHandler(async (req, res) => { res.json(await uc.wallets.charge(String(req.params.sagaId))); }));
  router.post('/charges/:sagaId/refund', asyncHandler(async (req, res) => {
    res.json(await uc.refund.execute(String(req.params.sagaId), parse(refundSchema, req.body ?? {}).reason));
  }));
  return router;
}
