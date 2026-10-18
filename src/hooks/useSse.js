import { useEffect, useRef } from 'react';

/**
 * Subscribes to the server's SSE "dirty poke" stream. The handler usually just
 * refetches whatever the component displays. EventSource reconnects on its own
 * and the server sends keepalives, so this needs no retry logic.
 */
export function useSse(handler, types = null) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const typesKey = types ? types.join(',') : '';

  useEffect(() => {
    const allowed = typesKey ? new Set(typesKey.split(',')) : null;
    const source = new EventSource('/api/stream');
    source.onmessage = (event) => {
      let parsed;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!allowed || allowed.has(parsed.type)) handlerRef.current(parsed);
    };
    return () => source.close();
  }, [typesKey]);
}
