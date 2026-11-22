import { AsyncLocalStorage } from 'node:async_hooks';

/** Contexto por request: el correlation_id (= sagaId) viaja a través de todos los microservicios. */
export interface RequestContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(ctx: RequestContext, fn: () => T): T => storage.run(ctx, fn);
export const currentContext = (): RequestContext | undefined => storage.getStore();
export const currentCorrelationId = (): string | undefined => storage.getStore()?.correlationId;

export const CORRELATION_HEADER = 'x-correlation-id';
