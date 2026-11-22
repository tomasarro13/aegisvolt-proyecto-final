'use client';

import { useState } from 'react';
import type { AegisVoltApi } from '@/application/ports';
import type { ChargingSession, TelemetrySample } from '@/domain/models';
import { usePolling } from '../hooks/usePolling';
import { Chip, Empty, Panel } from './primitives';

/** Sesiones de carga y telemetría (energy-dispatch-service), con fin de sesión. */
export function SessionsPanel({ api, sessions, onChange }: { api: AegisVoltApi; sessions: ChargingSession[]; onChange: () => void }) {
  const active = sessions.filter((s) => s.status === 'ACTIVE');
  return (
    <Panel id="telemetria" title="Sesiones activas y telemetría" action={<span className="font-mono text-xs text-foreground-muted">{active.length} activas</span>}>
      {active.length === 0 ? <Empty>No hay vehículos cargando. Inicie una reserva para ver la telemetría.</Empty> : (
        <div className="grid gap-3 md:grid-cols-2">
          {active.map((s) => <SessionCard key={s.sagaId} api={api} session={s} onChange={onChange} />)}
        </div>
      )}
    </Panel>
  );
}

function SessionCard({ api, session, onChange }: { api: AegisVoltApi; session: ChargingSession; onChange: () => void }) {
  const { data: samples = [] } = usePolling(() => api.telemetry(session.sagaId), 3000, [api, session.sagaId]);
  const [busy, setBusy] = useState(false);
  const last = samples.at(-1);
  const progress = Math.min(100, ((last?.deliveredKwh ?? session.deliveredKwh) / session.targetKwh) * 100);

  return (
    <article className="rounded-xl border border-border bg-background-inset/60 p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-xs text-accent">{session.connectorId}</p>
          <p className="text-sm">{session.fleetId}</p>
        </div>
        <Chip tone="info" pulse>{last ? `${last.powerKw} kW` : 'iniciando'}</Chip>
      </div>
      <Sparkline samples={samples} />
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background"><div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} /></div>
      <dl className="mt-3 grid grid-cols-4 gap-2 font-mono text-[11px]">
        <div><dt className="text-foreground-muted">kWh</dt><dd>{last?.deliveredKwh ?? 0}/{session.targetKwh}</dd></div>
        <div><dt className="text-foreground-muted">V</dt><dd>{last?.voltageV ?? '—'}</dd></div>
        <div><dt className="text-foreground-muted">A</dt><dd>{last?.currentA ?? '—'}</dd></div>
        <div><dt className="text-foreground-muted">°C</dt><dd>{last?.temperatureC ?? '—'}</dd></div>
      </dl>
      <button className="btn btn-ghost mt-3 w-full text-xs" disabled={busy}
        onClick={async () => { setBusy(true); try { await api.stopSession(session.sagaId); onChange(); } finally { setBusy(false); } }}>
        {busy ? 'Deteniendo…' : 'Finalizar sesión y liberar conector'}
      </button>
    </article>
  );
}

function Sparkline({ samples }: { samples: TelemetrySample[] }) {
  if (samples.length < 2) return <div className="mt-3 h-14 rounded-lg bg-background/60" />;
  const max = Math.max(...samples.map((s) => s.powerKw), 1);
  const pts = samples.map((s, i) => `${(i / (samples.length - 1)) * 100},${40 - (s.powerKw / max) * 36}`).join(' ');
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="mt-3 h-14 w-full" aria-label="Potencia entregada (kW)">
      <polyline points={`0,40 ${pts} 100,40`} fill="color-mix(in oklab, var(--color-accent) 14%, transparent)" stroke="none" />
      <polyline points={pts} fill="none" stroke="var(--color-accent)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
