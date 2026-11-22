'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AegisVoltApi } from '@/application/ports';
import type { EnvironmentName } from '@/domain/models';
import { formatMoney } from '@/domain/rules';
import { GraphQLAegisVoltApi } from '@/infrastructure/graphql-api';
import { usePolling } from '../hooks/usePolling';
import { HyperMotion } from '../hypermotion/HyperMotion';
import { EnvironmentSwitcher } from './EnvironmentSwitcher';
import { FlagsPanel } from './FlagsPanel';
import { HistoryPanel } from './HistoryPanel';
import { Chip, Panel } from './primitives';
import { ReservationPanel, type Selection } from './ReservationPanel';
import { SessionsPanel } from './SessionsPanel';
import { StationsPanel } from './StationsPanel';

const ENV_ACCENT: Record<EnvironmentName, string> = { dev: 'text-env-dev', test: 'text-env-test', prod: 'text-env-prod' };

export function Dashboard({ environments, initial }: { environments: { name: EnvironmentName; configured: boolean }[]; initial: EnvironmentName }) {
  const [env, setEnv] = useState<EnvironmentName>(initial);
  const [selection, setSelection] = useState<Selection>();
  const api: AegisVoltApi = useMemo(() => new GraphQLAegisVoltApi(env), [env]);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('env') as EnvironmentName | null;
    if (fromUrl && environments.some((e) => e.name === fromUrl && e.configured)) setEnv(fromUrl);
  }, [environments]);
  const changeEnv = (e: EnvironmentName) => {
    setEnv(e); setSelection(undefined);
    window.history.replaceState(null, '', `?env=${e}`);
  };

  const overview = usePolling(() => api.overview(), 2000, [api]);
  const sagas = usePolling(() => api.sagas(30), 3000, [api]);
  const sessions = usePolling(() => api.sessions(), 3000, [api]);
  const refreshAll = useCallback(() => { void overview.refresh(); void sagas.refresh(); void sessions.refresh(); }, [overview, sagas, sessions]);

  const o = overview.data;
  const menuGroups = [
    { title: 'Operación', links: [{ label: 'Estaciones', href: '#estaciones' }, { label: 'Reservar carga', href: '#reserva' }, { label: 'Telemetría', href: '#telemetria' }] },
    { title: 'Control', links: [{ label: 'Feature flags', href: '#flags' }, { label: 'Historial SAGA', href: '#historial' }, { label: 'Billeteras', href: '#billeteras' }] },
  ];

  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-40">
        <HyperMotion component="fluid-simulation" className="absolute inset-0" props={{ color: env === 'prod' ? '#f87171' : env === 'test' ? '#fbbf24' : '#c9fd34', dissipation: 0.97, pointerSize: 0.004 }} />
      </div>
      <HyperMotion component="floating-menu" props={{ menuGroups, primaryButton: { label: 'Reservar', href: '#reserva' } }} />

      <main className="mx-auto max-w-7xl space-y-5 px-4 pb-16 pt-24 sm:px-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-foreground-muted">AegisVolt · e-Mobility B2B</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">
              Carga inteligente para{' '}
              <HyperMotion as="span" component="text-loop" className={`inline-block ${ENV_ACCENT[env]}`} props={{ texts: ['flotas eléctricas', 'última milla', 'electrolineras B2B', 'smart grids'], interval: 2400 }} />
            </h1>
          </div>
          <div className="flex flex-col items-start gap-2 md:items-end">
            <div className="flex items-center gap-2">
              <a href={`/graphiql/${env}`} target="_blank" rel="noreferrer" className="btn btn-ghost px-3 py-1.5 font-mono text-xs">GraphQL ↗</a>
              <EnvironmentSwitcher value={env} options={environments} onChange={changeEnv} />
            </div>
            {o && <p className="font-mono text-[11px] text-foreground-muted">GraphQL <span className={ENV_ACCENT[env]}>{o.environment.name}</span> · v{o.environment.version} · track {o.environment.track} · {o.environment.region}</p>}
          </div>
        </header>

        {overview.error && <p className="panel border-bad/40 p-4 text-sm text-bad">No se pudo conectar al API GraphQL de <b>{env}</b>: {overview.error}</p>}

        {o && (
          <>
            <div className="flex flex-wrap gap-2">
              {o.health.map((h) => <Chip key={h.service} tone={h.status === 'UP' ? 'ok' : 'bad'}>{h.service} · {h.latencyMs} ms</Chip>)}
            </div>
            <StationsPanel stations={o.stations} onPick={(stationId, connectorId) => { setSelection({ stationId, connectorId }); document.getElementById('reserva')?.scrollIntoView({ behavior: 'smooth' }); }} />
            <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
              <ReservationPanel api={api} stations={o.stations} wallets={o.wallets} flags={o.featureFlags} selection={selection} onSelection={setSelection} onDone={refreshAll} />
              <FlagsPanel api={api} env={o.environment} flags={o.featureFlags} onChange={refreshAll} />
            </div>
            <SessionsPanel api={api} sessions={sessions.data ?? []} onChange={refreshAll} />
            <HistoryPanel sagas={sagas.data ?? []} />
            <Panel id="billeteras" title="Billeteras de flotas">
              <div className="grid gap-3 sm:grid-cols-3">
                {o.wallets.map((w) => (
                  <div key={w.fleetId} className="rounded-xl border border-border bg-background-inset/60 p-4">
                    <p className="font-mono text-[11px] text-foreground-muted">{w.fleetId}</p>
                    <p className="text-sm">{w.fleetName}</p>
                    <p className="mt-1 text-2xl font-semibold">{formatMoney(w.balance, w.currency)}</p>
                    <button className="btn btn-ghost mt-2 px-2 py-1 text-xs" onClick={async () => { await api.topUp(w.fleetId, 100000); refreshAll(); }}>+ $100.000</button>
                  </div>
                ))}
              </div>
            </Panel>
          </>
        )}
      </main>
    </div>
  );
}
