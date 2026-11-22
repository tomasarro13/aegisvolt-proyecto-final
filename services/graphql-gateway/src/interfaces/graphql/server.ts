import { CORRELATION_HEADER, runWithContext, type Logger } from '@aegisvolt/shared';
import { createSchema, createYoga } from 'graphql-yoga';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { buildResolvers, type ResolverDeps } from './resolvers.js';

export const loadTypeDefs = (): string =>
  readFileSync(fileURLToPath(new URL('./schema.graphql', import.meta.url)), 'utf8');

/** Servidor HTTP: /graphql (GraphQL Yoga) + /health/* para probes de Kubernetes y canary. */
export function createGatewayServer(deps: ResolverDeps, logger: Logger, readiness: () => Promise<boolean>): Server {
  const yoga = createYoga({
    schema: createSchema({ typeDefs: loadTypeDefs(), resolvers: buildResolvers(deps) }),
    graphqlEndpoint: '/graphql',
    landingPage: deps.environment.name !== 'prod',
    graphiql: deps.environment.name !== 'prod',
    cors: { origin: (process.env.CORS_ORIGINS ?? '*').split(','), credentials: false },
    logging: false,
    maskedErrors: { maskError: (error, message) => {
      logger.error('error GraphQL no controlado', { error });
      return new Error(message);
    } },
  });

  const chaosRate = Number(process.env.CHAOS_ERROR_RATE ?? 0); // solo demo de rollback del canary
  if (chaosRate > 0) logger.warn('CHAOS_ERROR_RATE activo en esta réplica', { chaos_error_rate: chaosRate });

  return createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/health/live')) { res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"UP"}'); return; }
    if (url.startsWith('/health/ready')) {
      void readiness().then((ok) => res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }).end(JSON.stringify({ status: ok ? 'UP' : 'DOWN' })));
      return;
    }
    const correlationId = (req.headers[CORRELATION_HEADER] as string | undefined) ?? randomUUID();
    const started = performance.now();
    res.setHeader(CORRELATION_HEADER, correlationId);
    res.setHeader('x-aegisvolt-version', deps.environment.version);
    res.setHeader('x-aegisvolt-track', deps.environment.track);
    res.on('finish', () => runWithContext({ correlationId }, () => {
      const fields = { http: { method: req.method, path: url.split('?')[0], status: res.statusCode, duration_ms: Math.round(performance.now() - started) } };
      if (res.statusCode >= 500) logger.error('request completed', fields); else logger.info('request completed', fields);
    }));
    if (chaosRate > 0 && Math.random() < chaosRate) {
      res.writeHead(500, { 'content-type': 'application/json' }).end('{"errors":[{"message":"CHAOS_INJECTED"}]}');
      return;
    }
    runWithContext({ correlationId }, () => { void yoga(req, res); });
  });
}
