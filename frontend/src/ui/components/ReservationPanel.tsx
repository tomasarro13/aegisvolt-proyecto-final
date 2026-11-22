'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AegisVoltApi } from '@/application/ports';
import type { FeatureFlag, PriceQuote, SagaTransaction, Station, Wallet } from '@/domain/models';
import { formatMoney } from '@/domain/rules';
import { Panel } from './primitives';
import { SagaTimeline } from './SagaTimeline';

export interface Selection { stationId: string; connectorId: string }

/** Flujo "Reservar y Activar Carga": dispara la mutación que inicia la SAGA distribuida. */
export function ReservationPanel({ api, stations, wallets, flags, selection, onSelection, onDone }: {
  api: AegisVoltApi;
  stations: Station[];
  wallets: Wallet[];
  flags: FeatureFlag[];
  selection?: Selection;
  onSelection: (s: Selection) => void;
  onDone: () => void;
}) {
  const [fleetId, setFleetId] = useState('');
  const [kwh, setKwh] = useState(25);
  const [boost, setBoost] = useState(false);
  const [quote, setQuote] = useState<PriceQuote>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SagaTransaction>();
  const [error, setError] = useState<string>();

  const station = stations.find((s) => s.id === selection?.stationId);
  const connector = station?.connectors.find((c) => c.id === selection?.connectorId);
  const faultOn = flags.find((f) => f.key === 'SIMULATE_CHARGER_HARDWARE_FAULT')?.enabled;
  const boostOn = flags.find((f) => f.key === 'ENABLE_FAST_CHARGE_BOOST')?.enabled;
  const wallet = wallets.find((w) => w.fleetId === fleetId);
  const available = useMemo(() => stations.flatMap((s) => s.connectors.filter((c) => c.status === 'AVAILABLE').map((c) => ({ s, c }))), [stations]);

  useEffect(() => { if (!fleetId && wallets[0]) setFleetId(wallets[0].fleetId); }, [wallets, fleetId]);
  useEffect(() => {
    if (!connector) { setQuote(undefined); return; }
    let live = true;
    api.quote(kwh, connector.powerKw, boost).then((q) => live && setQuote(q)).catch(() => live && setQuote(undefined));
    return () => { live = false; };
  }, [api, connector?.powerKw, kwh, boost, flags]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (!selection) return;
    setBusy(true); setError(undefined); setResult(undefined);
    try {
      setResult(await api.reserveAndActivate({ fleetId, stationId: selection.stationId, connectorId: selection.connectorId, estimatedKwh: kwh, fastChargeBoost: boost }));
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel id="reserva" title="Reservar y activar carga (SAGA)" action={faultOn ? <span className="chip tone-bad">⚠ inyección de fallas activa</span> : undefined}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-xs text-foreground-muted">Flota
            <select className="input mt-1" value={fleetId} onChange={(e) => setFleetId(e.target.value)}>
              {wallets.map((w) => <option key={w.fleetId} value={w.fleetId}>{w.fleetName} — {formatMoney(w.balance, w.currency)}</option>)}
            </select>
          </label>
          <label className="block text-xs text-foreground-muted">Conector disponible
            <select className="input mt-1" value={selection ? `${selection.stationId}|${selection.connectorId}` : ''}
              onChange={(e) => { const [stationId, connectorId] = e.target.value.split('|'); if (stationId && connectorId) onSelection({ stationId, connectorId }); }}>
              <option value="" disabled>Seleccione en el panel o aquí…</option>
              {available.map(({ s, c }) => <option key={c.id} value={`${s.id}|${c.id}`}>{s.city} · {s.name} · {c.id} ({c.powerKw} kW)</option>)}
            </select>
          </label>
          <label className="block text-xs text-foreground-muted">Energía estimada: <b className="text-foreground">{kwh} kWh</b>
            <input type="range" min={5} max={120} step={5} value={kwh} onChange={(e) => setKwh(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-accent)]" />
          </label>
          <label className={`flex items-center gap-2 text-sm ${boostOn ? '' : 'opacity-50'}`}>
            <input type="checkbox" checked={boost} onChange={(e) => setBoost(e.target.checked)} className="accent-[var(--color-accent)]" />
            Reserva prioritaria ultra-carga {boostOn ? '' : '(ENABLE_FAST_CHARGE_BOOST apagada en este ambiente)'}
          </label>
          <div className="rounded-xl border border-border bg-background-inset p-3 text-sm">
            {quote ? (
              <div className="flex items-end justify-between">
                <div className="font-mono text-xs text-foreground-muted">
                  <p>{quote.estimatedKwh} kWh × {formatMoney(quote.baseRatePerKwh)}/kWh</p>
                  <p>surge x{quote.surgeMultiplier} · boost x{quote.boostMultiplier} · {quote.strategy}</p>
                </div>
                <p className="text-xl font-semibold text-accent">{formatMoney(quote.total, quote.currency)}</p>
              </div>
            ) : <p className="text-foreground-muted">Seleccione un conector para cotizar.</p>}
            {wallet && quote && wallet.balance < quote.total && <p className="mt-2 text-xs text-warn">Saldo insuficiente: el paso 2 fallará y se liberará el conector (compensación).</p>}
          </div>
          <button className="btn btn-accent w-full" disabled={!selection || !fleetId || busy} onClick={submit}>
            {busy ? 'Ejecutando SAGA…' : 'Reservar y activar carga'}
          </button>
          {error && <p className="text-xs text-bad">{error}</p>}
        </div>
        <div>
          {result ? <SagaTimeline saga={result} /> : (
            <div className="grid h-full min-h-48 place-items-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-foreground-muted">
              <p>Reserva → Cobro → Activación física → Confirmación.<br />Si un paso falla, se ejecutan las transacciones compensatorias en orden inverso.</p>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
