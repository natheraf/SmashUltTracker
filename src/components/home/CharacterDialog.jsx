import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { formatDateTime, formatDuration, timeAgo } from '../../lib/format.js';
import CharacterImage from '../CharacterImage.jsx';
import Dialog from '../Dialog.jsx';

function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint ? <span className="stat-hint muted">{hint}</span> : null}
    </div>
  );
}

function Vod({ vod }) {
  const start = Number(vod.start_timestamp) > 0 ? Number(vod.start_timestamp) : null;
  const src = `https://www.youtube-nocookie.com/embed/${vod.video_id}${start ? `?start=${start}` : ''}`;
  return (
    <figure className="vod">
      <div className="vod-frame">
        <iframe
          src={src}
          title={vod.title || 'Approved VOD'}
          loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
      <figcaption>
        <a href={vod.youtube_url} target="_blank" rel="noreferrer noopener">
          {vod.title || 'Watch on YouTube'}
        </a>
        {start ? <span className="muted"> · starts at {formatDuration(start)}</span> : null}
      </figcaption>
    </figure>
  );
}

/**
 * Per-character dialog: the streamer's record on that fighter plus the approved
 * VODs of the completion. Stats load lazily when the dialog opens.
 */
export default function CharacterDialog({ streamerId, streamerName, character, onClose }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    api(`/api/streamers/${streamerId}/characters/${character.id}`, { signal: controller.signal })
      .then(setDetail)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      });
    return () => controller.abort();
  }, [streamerId, character.id]);

  return (
    <Dialog title={`${character.name} — ${streamerName}`} onClose={onClose} wide>
      <div className="char-dialog-head">
        <CharacterImage slug={character.slug} name={character.name} size={72} />
        <div>
          <p className="char-dialog-series muted">{character.series}</p>
          {detail?.completion ? (
            <p>
              Completed {formatDateTime(detail.completion.completed_at)}
              <span className="muted">
                {' '}
                · {detail.completion.attempts_count} attempt
                {detail.completion.attempts_count === 1 ? '' : 's'} ·{' '}
                {formatDuration(detail.completion.duration_seconds)}
              </span>
            </p>
          ) : (
            <p className="muted">Not completed yet</p>
          )}
          {detail?.streak ? (
            <p className="muted">
              Current run: {detail.streak.wins}/50 · {formatDuration(detail.streak.elapsed_seconds)}
            </p>
          ) : null}
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {!detail && !error ? <p className="muted">Loading stats…</p> : null}

      {detail ? (
        <>
          <div className="stat-grid">
            <Stat label="Attempts" value={detail.attempts.count} />
            <Stat label="Runs won" value={detail.attempts.completed} hint="reached 50 wins" />
            <Stat label="Losses" value={detail.attempts.failed} hint="failed attempts" />
            <Stat label="Resets" value={detail.attempts.reset} />
            <Stat
              label="Best streak"
              value={`${detail.attempts.best_wins || detail.streak?.wins || 0}/50`}
              hint="most wins in one run"
            />
            <Stat label="Time played" value={formatDuration(detail.attempts.total_seconds)} />
            {detail.completion ? (
              <Stat
                label="Attempts to complete"
                value={detail.completion.attempts_count}
                hint={`completed ${timeAgo(detail.completion.completed_at)}`}
              />
            ) : null}
          </div>

          {detail.vods.length > 0 ? (
            <section className="vod-list">
              <h3>Approved VODs</h3>
              {detail.vods.map((vod) => (
                <Vod key={vod.video_id} vod={vod} />
              ))}
            </section>
          ) : (
            <p className="muted">No approved VODs for this fighter yet.</p>
          )}

          {detail.recent_attempts.length > 0 ? (
            <section className="recent-attempts">
              <h3>Recent runs</h3>
              <ul>
                {detail.recent_attempts.map((attempt, index) => (
                  <li key={`${attempt.ended_at}-${index}`}>
                    <span className={`result result-${attempt.result}`}>{attempt.result}</span>
                    <span>
                      {attempt.wins}/50 · {formatDuration(attempt.duration_seconds)}
                    </span>
                    <span className="muted">{timeAgo(attempt.ended_at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </Dialog>
  );
}
