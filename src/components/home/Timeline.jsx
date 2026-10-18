import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { formatDateTime, formatDuration, timeAgo } from '../../lib/format.js';
import { useSse } from '../../hooks/useSse.js';
import CharacterImage from '../CharacterImage.jsx';

/** Turns a timeline row into a sentence plus optional detail and tone. */
function describe(event) {
  const who = event.streamer?.display_name || 'A streamer';
  const character = event.character?.name;
  const payload = event.payload || {};

  switch (event.type) {
    case 'completion':
      return {
        text: `${who} completed ${character}`,
        detail: `${payload.attempts || 1} attempt${payload.attempts === 1 ? '' : 's'} · ${formatDuration(payload.duration_seconds)}`,
        tone: 'good',
      };
    case 'milestone':
      return { text: `${who} reached ${payload.wins} wins with ${character}`, tone: 'good' };
    case 'streak_failed':
      return {
        text: `${who} lost the streak with ${character} at ${payload.wins} wins`,
        detail: formatDuration(payload.duration_seconds),
        tone: 'bad',
      };
    case 'ironman_started':
      return { text: `${who} started an Ironman run`, tone: 'info' };
    case 'ironman_failed':
      return {
        text: `${who} wiped the Ironman run with ${payload.character} at ${payload.won} won`,
        tone: 'bad',
      };
    case 'ironman_completed':
      return {
        text: `${who} completed Ironman — every fighter beaten`,
        detail: formatDuration(payload.duration_seconds),
        tone: 'good',
      };
    case 'vod_approved':
      return { text: `A VOD of ${who} with ${character} was approved`, tone: 'info' };
    case 'vote_winner':
      return { text: `${character} won the daily "who's next?" vote`, tone: 'info' };
    case 'streamer_joined':
      return { text: `${payload.display_name || who} joined the tracker`, tone: 'info' };
    default:
      return { text: `${who} — ${event.type}`, tone: 'info' };
  }
}

/** Newest-first community timeline with "load older" pagination. */
export default function Timeline() {
  const [events, setEvents] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [busy, setBusy] = useState(false);
  const pagedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await api('/api/timeline');
      setEvents(data.events);
      setNextBefore(data.next_before);
      pagedRef.current = false;
    } catch {
      setEvents((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Live updates only make sense while the first page is on screen; once the
  // reader has paged back, inserting rows would shift what they are reading.
  useSse(() => {
    if (!pagedRef.current) load();
  }, ['timeline']);

  const loadMore = async () => {
    if (!nextBefore) return;
    setBusy(true);
    try {
      const data = await api(`/api/timeline?before=${nextBefore}`);
      setEvents((current) => [...(current || []), ...data.events]);
      setNextBefore(data.next_before);
      pagedRef.current = true;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel timeline" aria-labelledby="timeline-title">
      <h2 id="timeline-title">Timeline</h2>
      {events === null ? <p className="muted">Loading…</p> : null}
      {events?.length === 0 ? <p className="muted">Nothing has happened yet. Go win some games.</p> : null}
      <ol className="timeline-list">
        {(events || []).map((event) => {
          const item = describe(event);
          return (
            <li key={event.id} className={`timeline-event tone-${item.tone}`}>
              {event.character ? (
                <CharacterImage slug={event.character.slug} name={event.character.name} size={32} />
              ) : (
                <span className="timeline-dot" aria-hidden="true" />
              )}
              <div className="timeline-body">
                <p>{item.text}</p>
                {item.detail ? <p className="muted">{item.detail}</p> : null}
              </div>
              <time dateTime={event.created_at} title={formatDateTime(event.created_at)}>
                {timeAgo(event.created_at)}
              </time>
            </li>
          );
        })}
      </ol>
      {nextBefore ? (
        <button type="button" className="btn" onClick={loadMore} disabled={busy}>
          {busy ? 'Loading…' : 'Load older events'}
        </button>
      ) : null}
    </section>
  );
}
