import { useEffect, useState } from 'react';

/**
 * Local one-second ticker for a server-provided elapsed count. The server
 * value is authoritative and resets the local counter on every refetch, so
 * drift never accumulates beyond one event.
 */
export function useTicker(baseSeconds, running) {
  const [seconds, setSeconds] = useState(baseSeconds || 0);

  useEffect(() => {
    setSeconds(baseSeconds || 0);
  }, [baseSeconds, running]);

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running, baseSeconds]);

  return seconds;
}
