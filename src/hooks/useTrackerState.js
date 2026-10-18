import { useCallback, useEffect, useState } from 'react';
import { api, post } from '../api.js';
import { useSse } from './useSse.js';

/**
 * Owns the tracker state for the logged-in streamer:
 *  - heartbeat every 30s (and on tab focus) keeps the session "active"
 *  - SSE pokes refetch, so a second tab / the overlay never drift
 *  - act() posts an action and adopts the returned state immediately
 */
export function useTrackerState(userId) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState(await api('/api/tracker/state'));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    const beat = async () => {
      try {
        const res = await post('/api/tracker/heartbeat');
        if (!cancelled) setState(res.state);
      } catch {
        /* transient — the next tick or SSE reconnect retries */
      }
    };
    beat();
    const id = setInterval(beat, 30_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') beat();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId]);

  useSse(
    (event) => {
      if (event.streamerId === userId || event.streamerId == null) refresh();
    },
    ['tracker', 'ironman', 'timeline'],
  );

  const act = useCallback(async (path, body) => {
    setBusy(true);
    setError(null);
    try {
      const res = await post(`/api/tracker${path}`, body ?? {});
      if (res?.state) setState(res.state);
      return res;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, error, busy, act, refresh, clearError: () => setError(null) };
}
