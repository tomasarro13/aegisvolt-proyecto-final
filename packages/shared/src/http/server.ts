import express, { type ErrorRequestHandler, type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppError } from '../errors.js';
import { CORRELATION_HEADER, runWithContext } from '../logging/context.js';
import type { Logger } from '../logging/logger.js';

export interface HealthCheck {
  name: string;
  check(): Promise<void>;
}

/**
 * Crea una app Express con las preocupaciones transversales comunes a todos los microservicios:
 * correlation_id, log de cada request (base de la métrica de error del canary), health checks y
 * traducción de errores de aplicación a HTTP.
 */
export function createHttpApp(logger: Logger, healthChecks: HealthCheck[] = []): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  app.use((req: Request, res: Response, next: NextFunction) => {
    const correlationId = req.header(CORRELATION_HEADER) ?? randomUUID();
    res.setHeader(CORRELATION_HEADER, correlationId);
    const started = performance.now();
    res.on('finish', () => {
      if (req.path.startsWith('/health')) return;
      runWithContext({ correlationId }, () => {
        const fields = { http: { method: req.method, path: req.path, status: res.statusCode, duration_ms: Math.round(performance.now() - started) } };
        if (res.statusCode >= 500) logger.error('request completed', fields);
        else logger.info('request completed', fields);
      });
    });
    runWithContext({ correlationId }, next);
  });

  // Inyección de caos (solo para demostrar el rollback del Canary): CHAOS_ERROR_RATE=0.5 => 50 % de 500s.
  const chaosRate = Number(process.env.CHAOS_ERROR_RATE ?? 0);
  if (chaosRate > 0) {
    logger.warn('CHAOS_ERROR_RATE activo en esta réplica', { chaos_error_rate: chaosRate });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (!req.path.startsWith('/health') && Math.random() < chaosRate) {
        res.status(500).json({ error: { code: 'CHAOS_INJECTED', message: 'Error inyectado para la demo del canary' } });
        return;
      }
      next();
    });
  }

  app.get('/health/live', (_req, res) => { res.json({ status: 'UP' }); });
  app.get('/health/ready', async (_req, res) => {
    const results = await Promise.all(healthChecks.map(async (h) => {
      try { await h.check(); return { name: h.name, status: 'UP' }; } catch (err) {
        return { name: h.name, status: 'DOWN', error: (err as Error).message };
      }
    }));
    const up = results.every((r) => r.status === 'UP');
    res.status(up ? 200 : 503).json({ status: up ? 'UP' : 'DOWN', checks: results });
  });

  return app;
}

/** Envuelve handlers async para que Express 5 propague los errores al error handler. */
export const asyncHandler = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (err instanceof AppError) {
      res.status(err.httpStatus).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    logger.error('error no controlado', { error: err });
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Error interno' } });
  };
}

export function listen(app: Express, port: number, logger: Logger, onShutdown: () => Promise<void> = async () => {}): void {
  const server = app.listen(port, () => logger.info('servicio iniciado', { port }));
  const shutdown = (signal: string) => {
    logger.info('apagando servicio', { signal });
    server.close(() => { void onShutdown().finally(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
