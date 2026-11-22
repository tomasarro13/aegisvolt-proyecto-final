'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Consulta periódica ("tiempo real" por polling) con cancelación al cambiar dependencias. */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    try {
      setData(await fetcherRef.current());
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setData(undefined);
    void refresh();
    const id = setInterval(() => { if (!document.hidden) void refresh(); }, intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, refresh };
}
