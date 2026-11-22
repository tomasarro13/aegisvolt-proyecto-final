import type { ReactNode } from 'react';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'idle';

export function Chip({ tone, children, pulse }: { tone: Tone; children: ReactNode; pulse?: boolean }) {
  return (
    <span className={`chip tone-${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${pulse ? 'animate-pulse' : ''}`} />
      {children}
    </span>
  );
}

export function Panel({ id, title, action, children, className = '' }: { id?: string; title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`panel scroll-mt-24 p-5 ${className}`}>
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="panel-title">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-foreground-muted">{children}</p>;
}
