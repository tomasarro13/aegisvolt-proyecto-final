'use client';

import { CONNECTOR_TONE, connectorKind } from '@/domain/rules';
import type { Station } from '@/domain/models';
import { HyperMotion } from '../hypermotion/HyperMotion';
import { Chip, Empty, Panel } from './primitives';

export function StationsPanel({ stations, onPick }: { stations: Station[]; onPick: (stationId: string, connectorId: string) => void }) {
  const markers = stations.map((s) => ({ location: [s.latitude, s.longitude], size: 0.06, id: s.id }));
  const total = stations.reduce((n, s) => n + s.connectors.length, 0);
  const free = stations.reduce((n, s) => n + s.availableConnectors, 0);

  return (
    <Panel id="estaciones" title="Electrolineras y conectores en tiempo real" action={<span className="font-mono text-xs text-foreground-muted">{free}/{total} disponibles · refresco 2 s</span>}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_1fr]">
        <div className="relative hidden aspect-square overflow-hidden rounded-xl border border-border bg-background lg:block">
          <HyperMotion component="globe" className="absolute inset-0" props={{ markers, autoRotate: true, pointCount: 9000, landPointColor: '#c9fd34', scale: 1.05, focusOn: [4.6, -74.1] }} />
          <p className="pointer-events-none absolute bottom-3 left-3 font-mono text-[10px] text-foreground-muted">{stations.length} estaciones · Latinoamérica</p>
        </div>
        {stations.length === 0 ? <Empty>Sin estaciones en este ambiente.</Empty> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {stations.map((s) => (
              <article key={s.id} className="rounded-xl border border-border bg-background-inset/60 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-[11px] text-accent">{s.id}</p>
                    <h3 className="font-semibold leading-tight">{s.name}</h3>
                    <p className="text-xs text-foreground-muted">{s.city} · {s.address}</p>
                  </div>
                  <Chip tone={s.availableConnectors > 0 ? 'ok' : 'bad'}>{s.availableConnectors} libres</Chip>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {s.connectors.map((c) => (
                    <li key={c.id}>
                      <button
                        disabled={c.status !== 'AVAILABLE'}
                        onClick={() => onPick(s.id, c.id)}
                        className="group flex w-full items-center justify-between rounded-lg border border-transparent px-2 py-1.5 text-left text-sm transition hover:border-accent/40 hover:bg-background disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent"
                      >
                        <span className="font-mono text-xs">{c.id.split('-').at(-1)} · {c.type} · {c.powerKw} kW <span className="text-foreground-muted">({connectorKind(c.powerKw)})</span></span>
                        <Chip tone={CONNECTOR_TONE[c.status]} pulse={c.status === 'CHARGING'}>{c.status}</Chip>
                      </button>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
