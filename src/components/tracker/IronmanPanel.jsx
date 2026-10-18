import { useTicker } from '../../hooks/useTicker.js';
import { formatDateTime, formatDuration } from '../../lib/format.js';

/**
 * Ironman mode panel. The full draft flow is built in the next step; this
 * already reflects the active run and lets the streamer switch back.
 */
export default function IronmanPanel({ state, act, busy }) {
  const run = state.ironman;
  const elapsed = useTicker(run?.accumulated_seconds || 0, Boolean(run?.running));

  return (
    <section className="card streak-panel">
      <div className="streak-head">
        <div>
          <h2>Ironman</h2>
          <p className="muted">
            {run
              ? `Run started ${formatDateTime(run.started_at)}`
              : 'No active run. The draft and win/loss tracking are on their way.'}
          </p>
        </div>
        {run ? (
          <div className="streak-timer">
            <div className={`timer mono ${run.running ? 'is-running' : ''}`}>
              {formatDuration(elapsed)}
            </div>
            <div className="timer-status">
              {run.paused ? 'Paused' : run.running ? 'Running' : 'Not ticking'}
            </div>
          </div>
        ) : null}
      </div>
      <div className="streak-actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => act('/mode', { mode: 'streak' })}
        >
          Back to 50-win streak
        </button>
      </div>
    </section>
  );
}
