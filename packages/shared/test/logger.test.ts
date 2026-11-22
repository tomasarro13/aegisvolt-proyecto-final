import { describe, expect, it } from 'vitest';
import { JsonLogger, runWithContext, type LogEntry } from '../src/index.js';

describe('JsonLogger', () => {
  it('incluye correlation_id, ambiente, servicio y track; los campos reservados no se pisan', () => {
    const entries: LogEntry[] = [];
    const logger = new JsonLogger({ service: 'billing-wallet-service', environment: 'test', version: '1.2.3', track: 'canary', sinks: [{ write: (e) => entries.push(e) }] });
    runWithContext({ correlationId: 'saga-42' }, () => logger.info('saldo debitado', { service: 'otro', amount: 10 }));
    expect(entries[0]).toMatchObject({ correlation_id: 'saga-42', environment: 'test', service: 'billing-wallet-service', track: 'canary', version: '1.2.3', amount: 10, level: 'info' });
  });
});
