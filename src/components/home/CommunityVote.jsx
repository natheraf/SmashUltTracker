/** One ranked entry with a proportional bar. */
function VoteBar({ label, votes, max }) {
  const pct = max > 0 ? Math.round((votes / max) * 100) : 0;
  return (
    <li className="vote-bar">
      <span className="vote-bar-label">{label}</span>
      <span className="vote-bar-track" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="vote-bar-count">{votes}</span>
    </li>
  );
}

/**
 * "Who's next?" — the community picks the next fighter. One vote per visitor
 * per UTC day, so the whole ballot locks once you have voted; the standings
 * come straight back from the server with your vote included.
 */
export default function CommunityVote({ standings, busy = false, error = null, onVote }) {
  if (!standings) return <p className="muted">Loading the poll…</p>;

  const myPick = standings.my_vote
    ? standings.candidates.find((row) => row.character.id === standings.my_vote) || null
    : null;
  const maxToday = standings.today.top[0]?.today_votes || 1;
  const maxMonth = standings.month.top[0]?.month_votes || 1;
  const voted = Boolean(standings.my_vote);

  return (
    <section className="panel vote-panel" aria-labelledby="vote-title">
      <div className="panel-head">
        <h2 id="vote-title">Who&apos;s next?</h2>
        <span className="muted">One vote per day · resets 00:00 UTC</span>
      </div>

      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}

      {standings.winner ? (
        <p className="vote-winner">
          Yesterday&apos;s winner: <strong>{standings.winner.character.name}</strong>
          <span className="muted">
            {' '}
            · {standings.winner.votes} vote{standings.winner.votes === 1 ? '' : 's'} on{' '}
            {standings.winner.utc_day}
          </span>
        </p>
      ) : null}

      {myPick ? (
        <p className="vote-thanks">
          You voted for <strong>{myPick.character.name}</strong> today.
          <span className="muted"> Come back tomorrow to vote again.</span>
        </p>
      ) : (
        <p className="muted">
          Pick the fighter you want to see next. The daily winner shows up on the timeline.
        </p>
      )}

      {standings.today.top.length > 0 ? (
        <div className="vote-boards">
          <section>
            <h3>
              Today <span className="muted">· {standings.today.total} votes</span>
            </h3>
            <ul className="vote-bars">
              {standings.today.top.map((row) => (
                <VoteBar
                  key={row.character.id}
                  label={row.character.name}
                  votes={row.today_votes}
                  max={maxToday}
                />
              ))}
            </ul>
          </section>
          {standings.month.top.length > 0 ? (
            <section>
              <h3>
                Last {standings.days} days <span className="muted">· {standings.month.total} votes</span>
              </h3>
              <ul className="vote-bars">
                {standings.month.top.map((row) => (
                  <VoteBar
                    key={row.character.id}
                    label={row.character.name}
                    votes={row.month_votes}
                    max={maxMonth}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      <h3 className="vote-ballot-title">Cast your vote</h3>
      <div className="vote-ballot">
        {standings.candidates.map((row) => {
          const isMine = standings.my_vote === row.character.id;
          return (
            <button
              key={row.character.id}
              type="button"
              className={isMine ? 'vote-chip is-voted' : 'vote-chip'}
              onClick={() => onVote(row.character.id)}
              disabled={voted || busy}
              aria-pressed={isMine}
            >
              <span className="vote-chip-name">{row.character.name}</span>
              {row.today_votes > 0 ? (
                <span className="vote-chip-count">{row.today_votes}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      {standings.candidates.length === 0 ? (
        <p className="muted">Every fighter is completed — there is nothing left to vote for.</p>
      ) : null}
    </section>
  );
}
