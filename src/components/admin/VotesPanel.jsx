import { useCallback, useEffect, useState } from 'react';
import { api, post } from '../../api.js';
import AdminSection, { AdminTable } from './AdminSection.jsx';

/**
 * Daily "who's next?" results: recorded winners (snapshotted at midnight UTC)
 * and today's running tally. Resetting a day clears its votes and its winner.
 */
export default function VotesPanel() {
  const [history, setHistory] = useState(null);
  const [day, setDay] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api('/api/admin/votes?days=14')
      .then((data) => {
        setHistory(data);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function reset() {
    if (!day) return;
    if (!window.confirm(`Delete every vote cast on ${day}?`)) return;
    setBusy(true);
    try {
      await post('/api/admin/votes/reset', { day });
      setDay('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminSection
      title="Votes"
      hint="One vote per visitor per UTC day. Winners are announced on the timeline."
      error={error}
      actions={
        <button type="button" className="btn btn-sm" onClick={load}>
          Refresh
        </button>
      }
    >
      {!history ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <h3>Recorded winners</h3>
          {history.winners.length === 0 ? (
            <p className="muted">No finished voting days yet.</p>
          ) : (
            <AdminTable head={['Day', 'Winner', 'Votes']}>
              {history.winners.map((row) => (
                <tr key={row.utc_day}>
                  <td>{row.utc_day}</td>
                  <td>{row.character.name}</td>
                  <td>{row.votes}</td>
                </tr>
              ))}
            </AdminTable>
          )}

          <h3>Daily totals</h3>
          {history.live.length === 0 ? (
            <p className="muted">No votes recorded yet.</p>
          ) : (
            <AdminTable head={['Day', 'Votes', 'Leader']}>
              {history.live.map((row) => (
                <tr key={row.utc_day}>
                  <td>{row.utc_day}</td>
                  <td>{row.total}</td>
                  <td className="muted">{row.leader_slug || '—'}</td>
                </tr>
              ))}
            </AdminTable>
          )}

          <div className="admin-reset">
            <div className="field">
              <label htmlFor="vote-reset-day">Reset a day</label>
              <input
                id="vote-reset-day"
                type="date"
                value={day}
                onChange={(event) => setDay(event.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-danger"
              disabled={!day || busy}
              onClick={reset}
            >
              Reset votes
            </button>
          </div>
        </>
      )}
    </AdminSection>
  );
}
