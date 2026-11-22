import { currentCorrelationId } from './context.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

/** Puerto de logging (DIP): los casos de uso dependen de esta abstracción, no de CloudWatch. */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

/** Un destino de logs (stdout, CloudWatch...). Nuevos destinos se agregan sin tocar el logger (OCP). */
export interface LogSink {
  write(entry: LogEntry): void;
  flush?(): Promise<void>;
}

export interface LogEntry extends LogFields {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  environment: string;
  version: string;
  track: string;
  correlation_id?: string;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface JsonLoggerOptions {
  service: string;
  environment: string;
  version: string;
  track: string;
  sinks: LogSink[];
  minLevel?: LogLevel;
  baseFields?: LogFields;
}

/** Logger estructurado JSON con correlation_id, ambiente, microservicio y versión desplegada. */
export class JsonLogger implements Logger {
  constructor(private readonly options: JsonLoggerOptions) {}

  debug(message: string, fields?: LogFields): void { this.log('debug', message, fields); }
  info(message: string, fields?: LogFields): void { this.log('info', message, fields); }
  warn(message: string, fields?: LogFields): void { this.log('warn', message, fields); }
  error(message: string, fields?: LogFields): void { this.log('error', message, fields); }

  child(fields: LogFields): Logger {
    return new JsonLogger({ ...this.options, baseFields: { ...this.options.baseFields, ...fields } });
  }

  async flush(): Promise<void> {
    await Promise.all(this.options.sinks.map((s) => s.flush?.()));
  }

  private log(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.options.minLevel ?? 'info']) return;
    // Los campos reservados van al final: un campo de negocio nunca puede sobrescribirlos.
    const entry: LogEntry = {
      ...this.options.baseFields,
      ...normalize(fields),
      timestamp: new Date().toISOString(),
      level,
      message,
      service: this.options.service,
      environment: this.options.environment,
      version: this.options.version,
      track: this.options.track,
      correlation_id: currentCorrelationId(),
    };
    for (const sink of this.options.sinks) sink.write(entry);
  }
}

function normalize(fields?: LogFields): LogFields {
  if (!fields) return {};
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = v instanceof Error ? { name: v.name, message: v.message, ...(v as unknown as LogFields) } : v;
  }
  return out;
}

export class StdoutSink implements LogSink {
  write(entry: LogEntry): void {
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }
}

/** Logger silencioso para pruebas unitarias. */
export class NoopLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  child(): Logger { return this; }
}
