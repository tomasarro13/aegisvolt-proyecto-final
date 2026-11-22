'use client';

import type { EnvironmentName } from '@/domain/models';

const STYLE: Record<EnvironmentName, string> = {
  dev: 'data-[on=true]:bg-env-dev data-[on=true]:text-background',
  test: 'data-[on=true]:bg-env-test data-[on=true]:text-background',
  prod: 'data-[on=true]:bg-env-prod data-[on=true]:text-background',
};

export function EnvironmentSwitcher({ value, options, onChange }: {
  value: EnvironmentName;
  options: { name: EnvironmentName; configured: boolean }[];
  onChange: (env: EnvironmentName) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-border bg-background-inset p-1" role="tablist" aria-label="Ambiente">
      {options.map((o) => (
        <button
          key={o.name}
          role="tab"
          data-on={o.name === value}
          disabled={!o.configured}
          title={o.configured ? `Endpoint GraphQL de ${o.name}` : `${o.name} no configurado (GRAPHQL_URL_${o.name.toUpperCase()})`}
          onClick={() => onChange(o.name)}
          className={`rounded-lg px-4 py-1.5 font-mono text-xs uppercase tracking-wider text-foreground-muted transition disabled:opacity-30 ${STYLE[o.name]}`}
        >
          {o.name}
        </button>
      ))}
    </div>
  );
}
