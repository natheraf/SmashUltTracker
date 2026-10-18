import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import CharacterGrid from '../components/CharacterGrid.jsx';
import CharacterDialog from '../components/home/CharacterDialog.jsx';
import { IronmanCard, StreakCard } from '../components/home/LiveCards.jsx';
import Timeline from '../components/home/Timeline.jsx';
import { useSse } from '../hooks/useSse.js';
import { timeAgo } from '../lib/format.js';

/**
 * The public home page: who is live right now, the character-select grid for a
 * chosen streamer, per-fighter detail, and the community timeline. Everything
 * here is read-only; the tracker pages are the only writers.
 */
export default function Home() {
  const [home, setHome] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [tab, setTab] = useState('streak');
  const [pickedStreamerId, setPickedStreamerId] = useState(null);
  const [progress, setProgress] = useState(null);
  const [dialog, setDialog] = useState(null);

  const ironmanTabId = tab.startsWith('ironman:') ? Number(tab.slice('ironman:'.length)) : null;
  const activeStreamerId =
    ironmanTabId ?? pickedStreamerId ?? home?.primary_streamer_id ?? home?.streamers?.[0]?.id ?? null;

  const loadHome = useCallback(() => api('/api/home').then(setHome), []);
  const loadProgress = useCallback(
    (streamerId) =>
      streamerId
        ? api(`/api/streamers/${streamerId}`).then(setProgress)
        : Promise.resolve(setProgress(null)),
    [],
  );

  useEffect(() => {
    api('/api/characters')
      .then((data) => setCharacters(data.characters))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadHome().catch(() => {});
  }, [loadHome]);

  useEffect(() => {
    loadProgress(activeStreamerId).catch(() => setProgress(null));
  }, [activeStreamerId, loadProgress]);

  // Any tracker or Ironman action changes who is live and what the grid shows.
  useSse(() => {
    loadHome().catch(() => {});
    loadProgress(activeStreamerId).catch(() => {});
  }, ['tracker', 'ironman']);

  const openCharacter = useCallback(
    (id) => {
      const character = characters.find((entry) => entry.id === id);
      if (character && activeStreamerId) {
        setDialog({ streamerId: activeStreamerId, character });
      }
    },
    [characters, activeStreamerId],
  );

  const activeIronman = ironmanTabId
    ? home?.ironman.find((card) => card.streamer_id === ironmanTabId) || null
    : null;
  const viewStreamer =
    home?.streamers.find((streamer) => streamer.id === activeStreamerId) || null;
  const completed = useMemo(
    () => new Set((progress?.completions || []).map((row) => row.character_id)),
    [progress],
  );
  const total = characters.length || 86;

  if (!home) {
    return (
      <main className="page">
        <p className="muted">Loading the run…</p>
      </main>
    );
  }

  return (
    <main className="page home-page">
      <section className="home-hero">
        <div>
          <h1>50 wins with every fighter</h1>
          <p className="muted">
            Community tracker for the 50-win streak and Ironman challenges. Follow along live, or
            open a fighter to see how the run went.
          </p>
        </div>
        {progress ? (
          <p className="home-hero-count">
            <strong>{completed.size}</strong>
            <span className="muted"> / {total} fighters completed</span>
          </p>
        ) : null}
      </section>

      <div className="tabs" role="tablist" aria-label="Challenge views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'streak'}
          className={tab === 'streak' ? 'tab is-active' : 'tab'}
          onClick={() => setTab('streak')}
        >
          50-Win Streaks
        </button>
        {home.ironman.map((card) => {
          const value = `ironman:${card.streamer_id}`;
          return (
            <button
              key={card.run_id}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? 'tab is-active' : 'tab'}
              onClick={() => setTab(value)}
            >
              <span className="live-dot" aria-hidden="true" />
              Ironman · {card.display_name}
            </button>
          );
        })}
      </div>

      {home.streamers.length === 0 ? (
        <p className="muted">No streamer accounts have been approved yet. Check back soon.</p>
      ) : null}

      {tab === 'streak' ? (
        <>
          <section className="live-cards" aria-label="Streamers live now">
            {home.streaks.length === 0 ? (
              <p className="muted">Nobody is running the streak right now. The grid remembers.</p>
            ) : (
              home.streaks.map((card) => <StreakCard key={card.streamer_id} card={card} />)
            )}
          </section>

          {home.streamers.length > 0 ? (
            <section className="panel" aria-labelledby="streak-grid-title">
              <div className="panel-head">
                <h2 id="streak-grid-title">
                  {viewStreamer ? viewStreamer.display_name : 'Fighters'}
                  {progress?.live ? <span className="badge badge-live">live</span> : null}
                </h2>
                <label className="field field-inline">
                  <span>Streamer</span>
                  <select
                    value={viewStreamer ? String(viewStreamer.id) : ''}
                    onChange={(event) => setPickedStreamerId(Number(event.target.value))}
                  >
                    {home.streamers.map((streamer) => (
                      <option key={streamer.id} value={streamer.id}>
                        {streamer.display_name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="muted">
                {completed.size} / {total} completed
                {progress?.live
                  ? ' · in progress now'
                  : progress?.last_heartbeat
                    ? ` · last seen ${timeAgo(progress.last_heartbeat)}`
                    : ''}
              </p>
              {progress ? (
                <CharacterGrid
                  characters={characters}
                  streaks={progress.streaks}
                  completed={completed}
                  selectedId={progress.live ? progress.selected_character_id : null}
                  onSelect={openCharacter}
                  toolbar={false}
                  showTarget
                />
              ) : (
                <p className="muted">Loading fighters…</p>
              )}
            </section>
          ) : null}
        </>
      ) : activeIronman ? (
        <>
          <section className="live-cards" aria-label="Ironman run">
            <IronmanCard card={activeIronman} />
          </section>

          <section className="panel" aria-labelledby="ironman-grid-title">
            <div className="panel-head">
              <h2 id="ironman-grid-title">{activeIronman.display_name}&apos;s Ironman run</h2>
              <p className="muted">
                {activeIronman.won} / {activeIronman.total} fighters won
              </p>
            </div>
            <p className="muted">
              {activeIronman.drawn
                ? `Currently drawn: ${activeIronman.drawn.name}. One loss ends the run.`
                : 'Waiting for the next draw.'}
            </p>
            {progress?.ironman ? (
              <CharacterGrid
                characters={characters}
                completed={new Set(progress.ironman.won_ids)}
                selectedId={progress.ironman.current_draw?.character_id ?? null}
                onSelect={openCharacter}
                toolbar={false}
              />
            ) : (
              <p className="muted">Loading the run…</p>
            )}
          </section>
        </>
      ) : null}

      <Timeline />

      {dialog ? (
        <CharacterDialog
          streamerId={dialog.streamerId}
          streamerName={
            home.streamers.find((streamer) => streamer.id === dialog.streamerId)?.display_name ||
            'Streamer'
          }
          character={dialog.character}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </main>
  );
}
