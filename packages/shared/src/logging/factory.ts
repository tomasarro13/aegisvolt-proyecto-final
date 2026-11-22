import type { BaseConfig } from '../config/environment.js';
import { CloudWatchSink } from './cloudwatch-sink.js';
import { JsonLogger, StdoutSink, type LogSink } from './logger.js';

export function createLogger(config: BaseConfig): JsonLogger {
  const sinks: LogSink[] = [new StdoutSink()];
  if (config.cloudWatch.enabled) {
    sinks.push(new CloudWatchSink({
      logGroup: config.cloudWatch.logGroup,
      region: config.aws.region,
      endpoint: config.aws.endpoint,
    }));
  }
  return new JsonLogger({
    service: config.serviceName,
    environment: config.environment,
    version: config.serviceVersion,
    track: config.deploymentTrack,
    sinks,
    minLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | undefined) ?? 'info',
  });
}
