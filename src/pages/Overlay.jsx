import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import CharacterImage from '../components/CharacterImage.jsx';
import { useTicker } from '../hooks/useTicker.js';
import { formatDuration } from '../lib/format.js';

const MILESTONE_BITS = [
  { wins: 10, bit: 1 },
  { wins: 25, bit: 2 },
  { wins: 40, bit: 4 },
];

/**
 * OBS browser-source overlay. Transparent background, no site chrome, driven by
 * the streamer's capability token (the URL itself is the secret).
 */
export default function Overlay() {
  const { token } = useParams();
  const [state, setState] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('overlay-route');
    return () => document.documentElement.classList.remove('overlay-route');
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api(`/api/overlay/${token}/state`);
      setState(data.state);
      setMissing(false);
    } catch (err) {
      if (err.status === 404) setMissing(true);
    }
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Token-scoped poke stream; coalesce bursts into one refetch.
  useEffect(() => {
    const source = new EventSource(`/api/overlay/${token}/stream`);
    let timer = null;
    source.onmessage = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 120);
    };
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [token, refresh]);

  const elapsed = useTicker(state?.elapsed_seconds || 0, Boolean(state?.running));

  if (missing) {
    return (
      <div className="overlay-root">
        <div className="overlay-card overlay-error">
          <strong>Overlay not found</strong>
          <span>Check the URL from your tracker page.</span>
        </div>
      </div>
    );
  }
  if (!state) return <div className="overlay-root" />;

  const streakMode = state.mode === 'streak';
  const wins = state.wins || 0;
  const target = state.target || 50;

  return (
    <div className="overlay-root">
      <div className={`overlay-card ${state.in_progress ? 'is-live' : 'is-idle'}`}>
        <div className="overlay-char">
          {streakMode && state.character ? (
            <CharacterImage slug={state.character.slug} name={state.character.name} size={104} />
          ) : null}
          {!streakMode && state.drawn ? (
            <CharacterImage slug={state.drawn.slug} name={state.drawn.name} size={104} />
          ) : null}
        </div>
        <div className="overlay-body">
          <div className="overlay-top">
            <span className="overlay-name">
              {streakMode
                ? state.character?.name || 'No fighter selected'
                : state.drawn?.name || 'Ironman — no draw yet'}
            </span>
            {state.in_progress ? (
              <span className="badge badge-live">live</span>
            ) : (
              <span className="badge">offline</span>
            )}
          </div>

          {streakMode ? (
            <>
              <div className="overlay-wins">
                <strong>{wins}</strong>
                <span>/{target}</span>
                <span className={`overlay-timer mono ${state.running ? 'is-running' : ''}`}>
                  {formatDuration(elapsed)}
                </span>
              </div>
              <div className="overlay-bar">
                <i style={{ width: `${(wins / target) * 100}%` }} />
              </div>
              <div className="overlay-foot">
                <span>attempt #{state.attempt}</span>
                <span>best {state.best}</span>
                <span className="overlay-pips">
                  {MILESTONE_BITS.map((m) => (
                    <i
                      key={m.wins}
                      className={(state.milestones_reached & m.bit) !== 0 ? 'done' : ''}
                      title={`${m.wins} wins`}
                    />
                  ))}
                </span>
                <span>50-win streak</span>
              </div>
            </>
          ) : (
            <>
              <div className="overlay-wins">
                <strong>{state.won || 0}</strong>
                <span>/{state.total || 86} won</span>
                <span className={`overlay-timer mono ${state.running ? 'is-running' : ''}`}>
                  {formatDuration(elapsed)}
                </span>
              </div>
              <div className="overlay-bar">
                <i style={{ width: `${((state.won || 0) / (state.total || 86)) * 100}%` }} />
              </div>
              <div className="overlay-foot">
                <span>{state.drawn ? 'win it or lose the run' : 'waiting for the draw'}</span>
                {state.paused ? <span>paused</span> : null}
                <span>Ironman</span>
              </div>
            </>
          )}
        </div>
        <div className="overlay-streamer">{state.streamer?.display_name}</div>
      </div>
    </div>
  );
}
