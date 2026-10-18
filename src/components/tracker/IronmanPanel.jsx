import { useState } from 'react';
import CharacterImage from '../CharacterImage.jsx';
import Dialog from '../Dialog.jsx';
import { useTicker } from '../../hooks/useTicker.js';
import { formatDateTime, formatDuration } from '../../lib/format.js';

const STATUS_LABEL = {
  pending: 'not drawn yet',
  drawn: 'current draw',
  won: 'won',
  lost: 'lost',
};

/**
 * Ironman mode: draw a random fighter from the remaining pool, win with them,
 * and keep going. Unlike the streak mode a loss ends the run, so the controls
 * are deliberately blunt — win, or lose the run.
 */
export default function IronmanPanel({ state, act, busy, onComplete }) {
  const [dialog, setDialog] = useState(null);
  const [dialogError, setDialogError] = useState(null);

  const run = state.ironman;
  const history = state.ironman_history || [];
  const elapsed = useTicker(run?.elapsed_seconds || 0, Boolean(run?.running));

  async function confirm(action) {
    setDialogError(null);
    try {
      await action();
      setDialog(null);
    } catch (err) {
      setDialogError(err.message);
    }
  }

  const action = (path, body) => act(path, body).catch(() => null);

  if (!run) {
    return (
      <section className="card streak-panel ironman-panel">
        <h2>No run in progress</h2>
        <p className="muted">
          Ironman: every fighter is drawn at random and has to be won with once. One loss and the
          run is over — no rerolls, no second chances.
        </p>
        <ul className="ironman-rules">
          <li>Draw a random fighter from the remaining pool.</li>
          <li>Beat a game with them to bank the win.</li>
          <li>Lose once and the run ends.</li>
          <li>Win with all 86 to complete it.</li>
        </ul>
        <div className="streak-actions">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={busy}
            onClick={() => action('/ironman/start')}
          >
            Start a run
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => action('/mode', { mode: 'streak' })}
          >
            Back to 50-win streak
          </button>
        </div>
        {history.length ? <History runs={history} /> : null}
      </section>
    );
  }

  const draw = run.current_draw;
  const deckDone = run.won_count + run.lost_count;

  return (
    <section className="card streak-panel ironman-panel">
      <div className="ironman-draw">
        <div className="ironman-portrait">
          {draw ? (
            <CharacterImage slug={draw.slug} name={draw.name} size={132} />
          ) : (
            <div className="ironman-question" aria-hidden="true">
              ?
            </div>
          )}
        </div>
        <div className="ironman-draw-text">
          <h2>{draw ? draw.name : busy ? 'Drawing…' : 'Ready to draw'}</h2>
          <p className="muted">
            {draw
              ? 'Win to bank them. One loss ends the run.'
              : 'No fighter drawn. The roll is random and final.'}
          </p>
          <p className="streak-count">
            <strong>{run.won_count}</strong>
            <span className="muted"> / {run.total} won</span>
          </p>
          <div className="streak-bar">
            <i style={{ width: `${(run.won_count / (run.total || 86)) * 100}%` }} />
          </div>
        </div>
        <div className="streak-timer">
          <div className={`timer mono ${run.running ? 'is-running' : ''}`}>
            {formatDuration(elapsed)}
          </div>
          <div className="timer-status">
            {run.paused ? 'Paused' : run.running ? 'Running' : 'Not ticking'}
          </div>
        </div>
      </div>

      <div className="streak-actions">
        {draw ? (
          <>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={busy}
              onClick={async () => {
                const res = await act('/ironman/win').catch(() => null);
                if (res?.completed) onComplete?.({ name: draw.name });
              }}
            >
              Win with {draw.name}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => {
                setDialogError(null);
                setDialog('loss');
              }}
            >
              Loss — end the run…
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={busy}
            onClick={() => action('/ironman/draw')}
          >
            Draw a random fighter
          </button>
        )}
      </div>

      <div className="streak-actions secondary">
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() => action(run.paused ? '/ironman/resume' : '/ironman/pause')}
        >
          {run.paused ? 'Resume timer' : 'Pause timer'}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() => action('/mode', { mode: 'streak' })}
        >
          Switch to streak mode
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={busy}
          onClick={() => {
            setDialogError(null);
            setDialog('abandon');
          }}
        >
          Abandon run…
        </button>
      </div>

      <dl className="streak-meta-grid">
        <div>
          <dt>Won</dt>
          <dd>
            {run.won_count} / {run.total}
          </dd>
        </div>
        <div>
          <dt>Still to draw</dt>
          <dd>{run.entries.filter((entry) => entry.status === 'pending').length}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{formatDateTime(run.started_at)}</dd>
        </div>
      </dl>

      <h3 className="ironman-deck-title">
        Deck <span className="muted">{deckDone} / {run.total} resolved</span>
      </h3>
      <div className="ironman-deck">
        {run.entries
          .filter((entry) => entry.status !== 'pending')
          .map((entry) => (
            <div
              key={entry.entry_id}
              className={`ironman-tile is-${entry.status}`}
              title={`${entry.name} — ${STATUS_LABEL[entry.status]}`}
            >
              <CharacterImage slug={entry.slug} name={entry.name} size={52} />
            </div>
          ))}
        {deckDone === 0 ? (
          <p className="muted">Nothing drawn yet — the whole roster is still in the pool.</p>
        ) : null}
      </div>

      {dialog === 'loss' ? (
        <Dialog
          title="Lose the run?"
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
                onClick={() => confirm(() => act('/ironman/loss'))}
              >
                Record loss
              </button>
            </>
          }
        >
          <p>
            A loss with <strong>{draw?.name}</strong> ends the run. On a hardcore Ironman that is
            the whole point: {run.won_count} won before it ended.
          </p>
          {dialogError ? <p className="error-text">{dialogError}</p> : null}
        </Dialog>
      ) : null}

      {dialog === 'abandon' ? (
        <Dialog
          title="Abandon this run?"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDialog(null)}>
                Keep playing
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => confirm(() => act('/ironman/abandon'))}
              >
                Abandon run
              </button>
            </>
          }
        >
          <p>
            Ends the run without a loss and files it under your history as failed. Starting a new
            run lays out a fresh deck.
          </p>
          {dialogError ? <p className="error-text">{dialogError}</p> : null}
        </Dialog>
      ) : null}
    </section>
  );
}

function History({ runs }) {
  return (
    <div className="ironman-history">
      <h3>Past runs</h3>
      <ul>
        {runs.map((entry) => (
          <li key={entry.id}>
            <span className={`badge ${entry.status === 'completed' ? 'badge-done' : 'badge-idle'}`}>
              {entry.status}
            </span>
            <span>
              {entry.won_count} / {entry.total} won
            </span>
            <span className="muted">
              {formatDateTime(entry.ended_at || entry.started_at)} ·{' '}
              {formatDuration(entry.duration_seconds)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
