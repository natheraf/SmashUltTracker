import { useState } from 'react';
import CharacterImage from '../CharacterImage.jsx';
import Dialog from '../Dialog.jsx';
import { useTicker } from '../../hooks/useTicker.js';
import { formatDuration, parseDuration } from '../../lib/format.js';

const MILESTONES = [
  { wins: 10, bit: 1 },
  { wins: 25, bit: 2 },
  { wins: 40, bit: 4 },
];

/** The active streak: character, live timer, and every tracking control. */
export default function StreakPanel({ state, act, busy, characters, onCelebrate }) {
  const [dialog, setDialog] = useState(null);
  const [dialogError, setDialogError] = useState(null);
  const [setWins, setSetWins] = useState('0');
  const [startWins, setStartWins] = useState('0');
  const [startTime, setStartTime] = useState('0:00');

  const streak = state.active_streak;
  const character = streak ? characters.find((c) => c.id === streak.character_id) : null;
  const elapsed = useTicker(streak?.elapsed_seconds || 0, Boolean(streak?.running));
  const wins = streak?.wins || 0;

  function open(name) {
    setDialogError(null);
    if (name === 'set') setSetWins(String(streak?.wins ?? 0));
    if (name === 'start') {
      setStartWins(String(streak?.wins ?? 0));
      setStartTime(formatDuration(streak?.elapsed_seconds ?? 0));
    }
    setDialog(name);
  }

  async function run(fn) {
    setDialogError(null);
    try {
      await fn();
      setDialog(null);
    } catch (err) {
      setDialogError(err.message);
    }
  }

  async function onWin() {
    const name = character?.name || 'this fighter';
    const res = await act('/streak/win').catch(() => null);
    if (res?.completion?.completed) onCelebrate({ name, attempts: res.completion.attemptsCount });
  }

  if (!state.selected_character_id || !character) {
    return (
      <section className="card streak-panel streak-empty">
        <h2>No fighter selected</h2>
        <p className="muted">
          Pick a character from the grid to start (or resume) their 50-win streak.
        </p>
      </section>
    );
  }

  const parsedSeconds = parseDuration(startTime);

  return (
    <section className="card streak-panel">
      <div className="streak-head">
        <CharacterImage slug={character.slug} name={character.name} size={104} className="streak-portrait" />
        <div className="streak-head-text">
          <h2>{character.name}</h2>
          <p className="streak-count">
            <strong>{wins}</strong>
            <span className="muted"> / 50 wins</span>
          </p>
          <div className="streak-bar">
            <i style={{ width: `${(wins / 50) * 100}%` }} />
          </div>
        </div>
        <div className="streak-timer">
          <div className={`timer mono ${streak?.running ? 'is-running' : ''}`}>
            {formatDuration(elapsed)}
          </div>
          <div className="timer-status">
            {streak?.paused ? 'Paused' : streak?.running ? 'Running' : 'Not ticking'}
          </div>
        </div>
      </div>

      <div className="streak-actions">
        <button type="button" className="btn btn-primary btn-lg" onClick={onWin} disabled={busy}>
          +1 win
        </button>
        <button type="button" className="btn btn-danger" onClick={() => open('loss')} disabled={busy}>
          Loss…
        </button>
      </div>

      <div className="streak-actions secondary">
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy || wins === 0}
          onClick={() => act('/streak/set', { wins: Math.max(0, wins - 1) }).catch(() => {})}
        >
          −1
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() => act(streak?.paused ? '/streak/resume' : '/streak/pause').catch(() => {})}
        >
          {streak?.paused ? 'Resume timer' : 'Pause timer'}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => open('set')} disabled={busy}>
          Set wins…
        </button>
        <button type="button" className="btn btn-sm" onClick={() => open('start')} disabled={busy}>
          Partial start…
        </button>
        <button type="button" className="btn btn-sm btn-danger" onClick={() => open('reset')} disabled={busy}>
          Reset…
        </button>
      </div>

      <dl className="streak-meta-grid">
        <div>
          <dt>This attempt</dt>
          <dd>#{state.active_attempt ?? '—'}</dd>
        </div>
        <div>
          <dt>Best streak</dt>
          <dd>{streak?.best ?? 0}</dd>
        </div>
        <div>
          <dt>Milestones</dt>
          <dd className="milestones">
            {MILESTONES.map((m) => (
              <span
                key={m.wins}
                className={`badge ${streak && (streak.milestones_reached & m.bit) ? 'badge-done' : ''}`}
              >
                {m.wins}
              </span>
            ))}
          </dd>
        </div>
      </dl>

      {dialog === 'loss' ? (
        <Dialog
          title={`Record a loss at ${wins} win${wins === 1 ? '' : 's'}?`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => run(() => act('/streak/loss'))}
              >
                Record loss
              </button>
            </>
          }
        >
          <p>
            {character.name}&apos;s streak resets to 0 and the timer restarts. The attempt ({wins}{' '}
            wins, {formatDuration(elapsed)}) is saved in the stats.
          </p>
          {dialogError ? <p className="error-text">{dialogError}</p> : null}
        </Dialog>
      ) : null}

      {dialog === 'set' ? (
        <Dialog
          title="Set exact wins"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => run(() => act('/streak/set', { wins: Number(setWins) }))}
              >
                Save
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="set-wins">Wins (0–50)</label>
            <input
              id="set-wins"
              type="number"
              min="0"
              max="50"
              value={setWins}
              onChange={(event) => setSetWins(event.target.value)}
            />
          </div>
          <p className="muted">For corrections only — milestones already reached stay recorded.</p>
          {dialogError ? <p className="error-text">{dialogError}</p> : null}
        </Dialog>
      ) : null}

      {dialog === 'start' ? (
        <Dialog
          title="Start partway"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || parseDuration(startTime) == null}
                onClick={() =>
                  run(() =>
                    act('/streak/start', {
                      character_id: character.id,
                      wins: Number(startWins),
                      seconds: parseDuration(startTime) ?? 0,
                    }),
                  )
                }
              >
                Start
              </button>
            </>
          }
        >
          <p className="muted">
            Starting mid-session (e.g. the stream began earlier)? Set the current wins and elapsed
            time; the timer continues from there.
          </p>
          <div className="field">
            <label htmlFor="start-wins">Wins (0–49)</label>
            <input
              id="start-wins"
              type="number"
              min="0"
              max="49"
              value={startWins}
              onChange={(event) => setStartWins(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="start-time">Elapsed time (MM:SS or H:MM:SS)</label>
            <input
              id="start-time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              placeholder="12:34"
            />
          </div>
          {dialogError ? <p className="error-text">{dialogError}</p> : null}
        </Dialog>
      ) : null}

      {dialog === 'reset' ? (
        <Dialog
          title="Reset this streak?"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => run(() => act('/streak/reset'))}
              >
                Delete streak
              </button>
            </>
          }
        >
          <p>
            Deletes {character.name}&apos;s saved streak ({wins} wins, {formatDuration(elapsed)}).
            Use this for a fresh start — not for a loss.
          </p>
          {dialogError ? <p className="error-text">{dialogError}</p> : null}
        </Dialog>
      ) : null}
    </section>
  );
}
