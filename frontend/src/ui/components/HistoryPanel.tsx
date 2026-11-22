'use client';

import { Fragment, useState } from 'react';
import type { SagaTransaction } from '@/domain/models';
import { formatMoney, SAGA_TONE, timeAgo } from '@/domain/rules';
import { Chip, Empty, Panel } from './primitives';
import { SagaTimeline } from './SagaTimeline';

/** Historial de transacciones SAGA y estado de sus compensaciones. */
export function HistoryPanel({ sagas }: { sagas: SagaTransaction[] }) {
  const [open, setOpen] = useState<string>();
  const compensated = sagas.filter((s) => s.status === 'COMPENSATED').length;
  const failedComp = sagas.filter((s) => s.status === 'COMPENSATION_FAILED').length;

  return (
    <Panel id="historial" title="Historial de transacciones y compensaciones"
      action={<span className="font-mono text-xs text-foreground-muted">{sagas.length} SAGAs · {compensated} compensadas{failedComp ? ` · ${failedComp} con falla` : ''}</span>}>
      {sagas.length === 0 ? <Empty>Aún no hay transacciones en este ambiente.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-foreground-muted">
              <tr><th className="pb-2 font-medium">SAGA</th><th className="pb-2 font-medium">Flota</th><th className="pb-2 font-medium">Conector</th><th className="pb-2 font-medium">Monto</th><th className="pb-2 font-medium">Estado</th><th className="pb-2 font-medium">Falla</th><th className="pb-2 font-medium" /></tr>
            </thead>
            <tbody>
              {sagas.map((s) => (
                <Fragment key={s.id}>
                  <tr className="cursor-pointer border-t border-border hover:bg-background-inset/50" onClick={() => setOpen(open === s.id ? undefined : s.id)}>
                    <td className="py-2 font-mono text-xs">{s.id.slice(0, 18)}…<br /><span className="text-foreground-muted">{timeAgo(s.createdAt)}</span></td>
                    <td className="py-2 text-xs">{s.fleetId}</td>
                    <td className="py-2 font-mono text-xs">{s.connectorId}</td>
                    <td className="py-2 font-mono text-xs">{formatMoney(s.chargedAmount, s.currency ?? 'COP')}</td>
                    <td className="py-2"><Chip tone={SAGA_TONE[s.status]}>{s.status}</Chip></td>
                    <td className="py-2 font-mono text-[11px] text-foreground-muted">{s.failure?.code ?? '—'}</td>
                    <td className="py-2 text-right text-xs text-foreground-muted">{open === s.id ? '▲' : '▼'}</td>
                  </tr>
                  {open === s.id && <tr><td colSpan={7} className="pb-3"><SagaTimeline saga={s} /></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
