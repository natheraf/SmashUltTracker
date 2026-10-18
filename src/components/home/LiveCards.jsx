import { useTicker } from '../../hooks/useTicker.js';
import { formatDuration } from '../../lib/format.js';
import CharacterImage from '../CharacterImage.jsx';

/** YouTube / Twitch links for a streamer card, as small icon buttons. */
export function StreamerLinks({ youtube_url: youtubeUrl, twitch_url: twitchUrl, displayName }) {
  if (!youtubeUrl && !twitchUrl) return null;
  return (
    <span className="streamer-links">
      {youtubeUrl ? (
        <a
          href={youtubeUrl}
          target="_blank"
          rel="noreferrer noopener"
          title="YouTube"
          aria-label={`${displayName} on YouTube`}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4L15.8 12l-6.2 3.6Z"
            />
          </svg>
        </a>
      ) : null}
      {twitchUrl ? (
        <a
          href={twitchUrl}
          target="_blank"
          rel="noreferrer noopener"
          title="Twitch"
          aria-label={`${displayName} on Twitch`}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M4.3 1 2 5.6v14.2h5v3.2h3.6l3.2-3.2h4.6L23 15V1H4.3Zm16.5 13.1-3.2 3.2h-5l-3.2 3.2v-3.2H6.2V3.2h14.6v10.9ZM17.5 7v5h-2.1V7h2.1Zm-5.6 0v5H9.8V7h2.1Z"
            />
          </svg>
        </a>
      ) : null}
    </span>
  );
}

function CardHead({ displayName, youtube_url, twitch_url }) {
  return (
    <header className="live-card-head">
      <span className="badge badge-live">live</span>
      <h3>{displayName}</h3>
      <StreamerLinks displayName={displayName} youtube_url={youtube_url} twitch_url={twitch_url} />
    </header>
  );
}

/** Live card for a streamer currently grinding a 50-win streak. */
export function StreakCard({ card }) {
  const seconds = useTicker(card.elapsed_seconds, card.running);
  return (
    <article className="live-card">
      <CardHead
        displayName={card.display_name}
        youtube_url={card.youtube_url}
        twitch_url={card.twitch_url}
      />
      <div className="live-card-body">
        <CharacterImage slug={card.character.slug} name={card.character.name} size={64} />
        <div className="live-card-stats">
          <p className="live-card-char">{card.character.name}</p>
          <p className="live-card-score">
            <strong>{card.wins}</strong>
            <span className="muted"> / {card.target} wins</span>
          </p>
          <p className="live-card-timer">
            {formatDuration(seconds)}
            {card.paused ? <span className="muted"> paused</span> : null}
          </p>
        </div>
      </div>
      <div className="meter" aria-hidden="true">
        <i style={{ width: `${Math.min(100, (card.wins / card.target) * 100)}%` }} />
      </div>
    </article>
  );
}

/** Live card for a streamer whose Ironman run is in progress. */
export function IronmanCard({ card }) {
  const seconds = useTicker(card.elapsed_seconds, card.running);
  return (
    <article className="live-card">
      <CardHead
        displayName={card.display_name}
        youtube_url={card.youtube_url}
        twitch_url={card.twitch_url}
      />
      <p className="live-card-tag">Ironman</p>
      <div className="live-card-body">
        {card.drawn ? (
          <CharacterImage slug={card.drawn.slug} name={card.drawn.name} size={64} />
        ) : null}
        <div className="live-card-stats">
          <p className="live-card-char">{card.drawn ? card.drawn.name : 'No draw yet'}</p>
          <p className="live-card-score">
            <strong>
              {card.won}
              <span className="muted"> / {card.total}</span>
            </strong>
            <span className="muted"> fighters won</span>
          </p>
          <p className="live-card-timer">
            {formatDuration(seconds)}
            {card.paused ? <span className="muted"> paused</span> : null}
          </p>
        </div>
      </div>
      <div className="meter" aria-hidden="true">
        <i style={{ width: `${Math.min(100, (card.won / card.total) * 100)}%` }} />
      </div>
    </article>
  );
}
