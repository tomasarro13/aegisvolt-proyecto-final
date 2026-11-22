'use client';

import { useState } from 'react';
import type { AegisVoltApi } from '@/application/ports';
import type { EnvironmentInfo, FeatureFlag } from '@/domain/models';
import { Panel } from './primitives';

/** Estado de las feature flags del ambiente activo. Cambiarlas no requiere redesplegar (TTL de caché 2 s). */
export function FlagsPanel({ api, env, flags, onChange }: { api: AegisVoltApi; env: EnvironmentInfo; flags: FeatureFlag[]; onChange: () => void }) {
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();

  async function toggle(flag: FeatureFlag) {
    setPending(flag.key); setError(undefined);
    try { await api.setFlag(flag.key, !flag.enabled); onChange(); } catch (err) { setError((err as Error).message); } finally { setPending(undefined); }
  }

  return (
    <Panel id="flags" title={`Feature flags · ${env.name}`} action={<span className="font-mono text-[11px] text-foreground-muted">aegisvolt-feature-flags-{env.name}</span>}>
      <ul className="space-y-2">
        {flags.map((f) => (
          <li key={f.key} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background-inset/60 p-3">
            <div className="min-w-0">
              <p className="truncate font-mono text-xs">{f.key}</p>
              <p className="text-xs text-foreground-muted">{f.description}</p>
              {f.updatedBy && <p className="mt-0.5 font-mono text-[10px] text-foreground-muted">por {f.updatedBy} · {f.updatedAt}</p>}
            </div>
            <button
              role="switch"
              aria-checked={f.enabled}
              disabled={!env.flagMutationsAllowed || pending === f.key}
              onClick={() => toggle(f)}
              title={env.flagMutationsAllowed ? 'Cambiar en caliente' : 'Bloqueado en este ambiente: cambio controlado vía DynamoDB/CLI'}
              className={`relative h-6 w-11 shrink-0 rounded-full border transition disabled:opacity-50 ${f.enabled ? (f.key === 'SIMULATE_CHARGER_HARDWARE_FAULT' ? 'border-bad bg-bad/70' : 'border-accent bg-accent/80') : 'border-border bg-background'}`}
            >
              <span className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-foreground transition-all ${f.enabled ? 'left-5.5' : 'left-0.5'}`} />
            </button>
          </li>
        ))}
      </ul>
      {!env.flagMutationsAllowed && <p className="mt-3 text-xs text-foreground-muted">En {env.name} los cambios por API están bloqueados (ALLOW_FLAG_MUTATIONS=false).</p>}
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
    </Panel>
  );
}
