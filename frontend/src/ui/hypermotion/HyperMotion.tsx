'use client';

import { useEffect, useRef } from 'react';

/**
 * Adaptador React para los componentes de HyperMotion (bundles ESM framework-agnostic que exportan
 * `render(target, props)` / `unmount(instance)`). Patrón Adapter: el resto de la UI usa componentes
 * React tipados y no sabe cómo se monta la librería.
 */
export type HyperMotionComponent = 'globe' | 'text-loop' | 'floating-menu' | 'fluid-simulation';

interface HyperMotionModule {
  render(target: HTMLElement, props: Record<string, unknown>): unknown;
  unmount(instance: unknown): void;
}

const cache = new Map<HyperMotionComponent, Promise<HyperMotionModule>>();
// import() de una URL en runtime, fuera del grafo del bundler.
const runtimeImport = new Function('url', 'return import(url)') as (url: string) => Promise<HyperMotionModule>;

function load(component: HyperMotionComponent): Promise<HyperMotionModule> {
  if (!cache.has(component)) cache.set(component, runtimeImport(`/vendor/hypermotion/${component}.js`));
  return cache.get(component)!;
}

export function HyperMotion({ component, props, className, as: Tag = 'div' }: {
  component: HyperMotionComponent;
  props: Record<string, unknown>;
  className?: string;
  as?: 'div' | 'span';
}) {
  const ref = useRef<HTMLElement | null>(null);
  const key = JSON.stringify(props);

  useEffect(() => {
    let instance: unknown;
    let mod: HyperMotionModule | undefined;
    let disposed = false;
    load(component).then((m) => {
      if (disposed || !ref.current) return;
      mod = m;
      instance = m.render(ref.current, JSON.parse(key));
    }).catch((err) => console.warn(`[HyperMotion] no se pudo cargar ${component}`, err));
    return () => {
      disposed = true;
      if (mod && instance) { try { mod.unmount(instance); } catch { /* ya desmontado */ } }
      if (ref.current) ref.current.innerHTML = '';
    };
  }, [component, key]);

  return <Tag ref={ref as never} className={className} />;
}
