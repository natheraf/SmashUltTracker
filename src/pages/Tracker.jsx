import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api.js';
import CharacterGrid from '../components/CharacterGrid.jsx';
import Dialog from '../components/Dialog.jsx';
import PendingPanel from '../components/tracker/PendingPanel.jsx';
import StreakPanel from '../components/tracker/StreakPanel.jsx';
import IronmanPanel from '../components/tracker/IronmanPanel.jsx';
import OverlayLink from '../components/tracker/OverlayLink.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useTrackerState } from '../hooks/useTrackerState.js';

export default function Tracker() {
  const { user, loading } = useAuth();
  const { state, error, busy, act, refresh } = useTrackerState(user?.id);
  const [characters, setCharacters] = useState([]);
  const [celebration, setCelebration] = useState(null);

  useEffect(() => {
    api('/api/characters')
      .then((data) => setCharacters(data.characters))
      .catch(() => {});
  }, []);

  if (loading) return <main className="page"><p className="muted">Loading…</p></main>;
  if (!user) return <Navigate to="/login?next=/tracker" replace />;
  if (user.status === 'pending') return <PendingPanel />;
  if (!state) {
    return (
      <main className="page">
        <p className="muted">{error || 'Loading tracker…'}</p>
      </main>
    );
  }

  const completed = new Set((state.completions || []).map((c) => c.character_id));
  const setMode = (mode) => act('/mode', { mode }).catch(() => {});

  return (
    <main className="page tracker-page">
      <div className="tracker-head">
        <div>
          <h1>{user.display_name}&apos;s tracker</h1>
          <p className="muted">
            {state.in_progress ? <span className="badge badge-live">live</span> : null}{' '}
            {completed.size} / {characters.length || 86} fighters completed
          </p>
        </div>
        <div className="mode-toggle" role="group" aria-label="Tracker mode">
          <button
            type="button"
            className={state.mode === 'streak' ? 'is-active' : ''}
            onClick={() => setMode('streak')}
            disabled={busy}
          >
            50-win streak
          </button>
          <button
            type="button"
            className={state.mode === 'ironman' ? 'is-active' : ''}
            onClick={() => setMode('ironman')}
            disabled={busy}
          >
            Ironman
          </button>
        </div>
      </div>

      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}

      <div className="tracker-columns">
        <div className="tracker-main">
          {state.mode === 'streak' ? (
            <StreakPanel
              state={state}
              act={act}
              busy={busy}
              characters={characters}
              onCelebrate={setCelebration}
            />
          ) : (
            <IronmanPanel state={state} act={act} busy={busy} />
          )}
          <OverlayLink token={state.overlay_token} onRegenerated={refresh} />
        </div>

        <div className="tracker-side">
          <h2 className="tracker-side-title">
            Fighters <span className="muted">{completed.size} / {characters.length || 86}</span>
          </h2>
          <CharacterGrid
            characters={characters}
            streaks={state.streaks}
            completed={completed}
            selectedId={state.selected_character_id}
            onSelect={(id) => {
              if (state.mode !== 'streak') act('/mode', { mode: 'streak' }).catch(() => {});
              act('/streak/select', { character_id: id }).catch(() => {});
            }}
          />
        </div>
      </div>

      {celebration ? (
        <Dialog
          title={`50 wins with ${celebration.name}!`}
          onClose={() => setCelebration(null)}
          footer={
            <button type="button" className="btn btn-primary" onClick={() => setCelebration(null)}>
              Pick the next fighter
            </button>
          }
        >
          <p>
            Completion saved after {celebration.attempts}{' '}
            {celebration.attempts === 1 ? 'attempt' : 'attempts'}. The streak is cleared — choose the
            next character from the grid whenever you are ready.
          </p>
        </Dialog>
      ) : null}
    </main>
  );
}
