import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  PutLogEventsCommand,
  ResourceAlreadyExistsException,
} from '@aws-sdk/client-cloudwatch-logs';
import os from 'node:os';
import type { LogEntry, LogSink } from './logger.js';

export interface CloudWatchSinkOptions {
  logGroup: string;
  region: string;
  endpoint?: string;
  streamName?: string;
  flushIntervalMs?: number;
  maxBatch?: number;
}

/**
 * Envía los logs JSON a CloudWatch Logs en lotes (/aegisvolt/<env>/<servicio>).
 * Nunca lanza excepciones: un fallo de observabilidad no debe tumbar el negocio.
 */
export class CloudWatchSink implements LogSink {
  private readonly client: CloudWatchLogsClient;
  private readonly stream: string;
  private buffer: { timestamp: number; message: string }[] = [];
  private ready?: Promise<void>;
  private readonly timer: NodeJS.Timeout;
  private flushing = Promise.resolve();

  constructor(private readonly options: CloudWatchSinkOptions) {
    this.client = new CloudWatchLogsClient({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    });
    this.stream = options.streamName ?? `${os.hostname()}-${process.pid}`;
    this.timer = setInterval(() => void this.flush(), options.flushIntervalMs ?? 2000);
    this.timer.unref();
  }

  write(entry: LogEntry): void {
    this.buffer.push({ timestamp: Date.parse(entry.timestamp), message: JSON.stringify(entry) });
    if (this.buffer.length >= (this.options.maxBatch ?? 100)) void this.flush();
  }

  flush(): Promise<void> {
    this.flushing = this.flushing.then(() => this.doFlush());
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      await this.ensureStream();
      await this.client.send(new PutLogEventsCommand({
        logGroupName: this.options.logGroup,
        logStreamName: this.stream,
        logEvents: batch.sort((a, b) => a.timestamp - b.timestamp),
      }));
    } catch (err) {
      this.ready = undefined; // reintenta crear el stream en el próximo flush
      process.stderr.write(`[cloudwatch-sink] no se pudieron enviar ${batch.length} logs: ${(err as Error).message}\n`);
    }
  }

  private ensureStream(): Promise<void> {
    this.ready ??= (async () => {
      await this.ignoreExists(this.client.send(new CreateLogGroupCommand({ logGroupName: this.options.logGroup })));
      await this.ignoreExists(this.client.send(new CreateLogStreamCommand({
        logGroupName: this.options.logGroup,
        logStreamName: this.stream,
      })));
    })();
    return this.ready;
  }

  private async ignoreExists(p: Promise<unknown>): Promise<void> {
    try { await p; } catch (err) {
      if (!(err instanceof ResourceAlreadyExistsException) && (err as Error).name !== 'ResourceAlreadyExistsException') throw err;
    }
  }
}
