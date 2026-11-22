import { Agent, fetch } from 'undici';
import { AppError } from '../errors.js';
import { CORRELATION_HEADER, currentCorrelationId } from '../logging/context.js';

export interface HttpClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  retries?: number;
}

/** Error remoto preservando el código de negocio devuelto por el microservicio. */
export class RemoteServiceError extends AppError {
  constructor(public readonly service: string, code: string, message: string, httpStatus: number, details?: Record<string, unknown>) {
    super(code, message, httpStatus, { ...details, service });
  }
}

/**
 * Cliente HTTP mínimo: propaga correlation_id, aplica timeout y reintenta solo errores
 * transitorios (red / 5xx). Los reintentos son seguros porque los endpoints son idempotentes por sagaId.
 */
/**
 * Sin keep-alive: cada request abre su conexión, así kube-proxy (balanceo por conexión) reparte el
 * tráfico entre pods stable y canary en proporción a sus réplicas.
 */
const noKeepAlive = new Agent({ pipelining: 0, connect: { timeout: 3000 } });

export class HttpClient {
  constructor(private readonly service: string, private readonly options: HttpClientOptions) {}

  get<T>(path: string): Promise<T> { return this.request<T>('GET', path); }
  post<T>(path: string, body?: unknown): Promise<T> { return this.request<T>('POST', path, body); }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const retries = this.options.retries ?? 2;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(`${this.options.baseUrl}${path}`, {
          method,
          headers: {
            'content-type': 'application/json',
            ...(currentCorrelationId() ? { [CORRELATION_HEADER]: currentCorrelationId()! } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 5000),
          dispatcher: noKeepAlive,
        });
        const payload = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; details?: Record<string, unknown> } };
        if (res.ok) return payload as T;
        const error = new RemoteServiceError(this.service, payload.error?.code ?? 'REMOTE_ERROR', payload.error?.message ?? `HTTP ${res.status}`, res.status, payload.error?.details);
        if (res.status < 500) throw error; // error de negocio: no reintentar
        lastError = error;
      } catch (err) {
        if (err instanceof RemoteServiceError && err.httpStatus < 500) throw err;
        lastError = err;
      }
      await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
    }
    if (lastError instanceof RemoteServiceError) throw lastError;
    throw new RemoteServiceError(this.service, 'SERVICE_UNAVAILABLE', `${this.service} no disponible: ${(lastError as Error)?.message}`, 503);
  }
}
