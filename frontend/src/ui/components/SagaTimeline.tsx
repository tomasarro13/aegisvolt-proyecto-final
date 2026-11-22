'use client';

import gsap from 'gsap';
import { useEffect, useRef } from 'react';
import type { SagaTransaction } from '@/domain/models';
import { formatMoney, SAGA_TONE, STEP_LABELS, STEP_TONE } from '@/domain/rules';
import { Chip } from './primitives';

/** Línea de tiempo animada (GSAP) de una SAGA: pasos ejecutados y compensaciones en orden inverso. */
export function SagaTimeline({ saga }: { saga: SagaTransaction }) {
  const ref = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo('[data-step]', { autoAlpha: 0, x: -16 }, { autoAlpha: 1, x: 0, duration: 0.45, stagger: 0.18, ease: 'power3.out' });
      gsap.fromTo('[data-comp]', { autoAlpha: 0, scale: 0.8 }, { autoAlpha: 1, scale: 1, duration: 0.4, delay: 0.9, stagger: -0.2, ease: 'back.out(2)' });
    }, ref);
    return () => ctx.revert();
  }, [saga.id, saga.status]);

  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs text-foreground-muted">correlation_id <span className="text-foreground">{saga.id}</span></p>
        <div className="flex items-center gap-2">
          {saga.prefectRunUrl && (
            <a href={saga.prefectRunUrl} target="_blank" rel="noreferrer" className="chip tone-info hover:brightness-125">Ver en Prefect ↗</a>
          )}
          <Chip tone={SAGA_TONE[saga.status]}>{saga.status}</Chip>
        </div>
      </div>
      <ol ref={ref} className="relative space-y-2 border-l border-border pl-5">
        {saga.steps.map((st, i) => (
          <li key={st.name} data-step className="relative">
            <span className={`absolute -left-[27px] top-1.5 grid h-3.5 w-3.5 place-items-center rounded-full border border-background tone-${STEP_TONE[st.status]}`} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm"><span className="mr-2 font-mono text-xs text-foreground-muted">{i + 1}</span>{STEP_LABELS[st.name] ?? st.name}
                <span className="ml-2 font-mono text-[11px] text-foreground-muted">{st.service}</span></p>
              <div className="flex items-center gap-1.5">
                {st.status === 'COMPENSATED' && <span data-comp className="chip tone-warn">↺ compensado</span>}
                <Chip tone={STEP_TONE[st.status]}>{st.status}</Chip>
              </div>
            </div>
            {st.errorCode && <p className="mt-1 font-mono text-[11px] text-bad">{st.errorCode}: {st.errorMessage}</p>}
          </li>
        ))}
      </ol>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Stat label="Cobrado" value={formatMoney(saga.chargedAmount, saga.currency ?? 'COP')} />
        <Stat label="Tarifa" value={saga.pricingStrategy ?? '—'} />
        <Stat label="Surge" value={saga.surgeMultiplier ? `x${saga.surgeMultiplier}` : '—'} />
        <Stat label="Boost" value={saga.priorityBoost ? 'prioritario' : 'no'} />
      </dl>
      {saga.failure && (
        <p className="mt-3 rounded-lg border border-warn/30 bg-warn/5 p-2 text-xs text-warn">
          Falló <b>{saga.failure.step}</b> ({saga.failure.code}). {saga.status === 'COMPENSATED' ? 'Rollback distribuido aplicado: saldo reembolsado y conector liberado.' : ''}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background-inset px-2.5 py-1.5">
      <dt className="text-[10px] uppercase tracking-wider text-foreground-muted">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
