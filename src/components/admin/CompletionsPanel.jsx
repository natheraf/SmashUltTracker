import { useCallback, useEffect, useState } from 'react';
import { api, del, post } from '../../api.js';
import { formatDateTime, formatDuration, parseDuration } from '../../lib/format.js';
import AdminSection, { AdminTable } from './AdminSection.jsx';

/**
 * Completions are the record of a finished fighter. Normally they appear on
 * their own (hitting 50 wins, or approving a VOD), but an admin can add one a
 * run was never tracked for — and revoke one that should not count.
 */
export default function CompletionsPanel() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [streamers, setStreamers] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({
    streamer_id: '',
    character_id: '',
    completed_at: '',
    attempts_count: '1',
    duration: '',
    note: '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/home')
      .then((data) => setStreamers(data.streamers))
      .catch(() => {});
    api('/api/characters')
      .then((data) => setCharacters(data.characters))
      .catch(() => {});
  }, []);

  const load = useCallback(
    (nextOffset = 0) => {
      const params = new URLSearchParams({ limit: '50', offset: String(nextOffset) });
      if (filter) params.set('streamer_id', filter);
      return api(`/api/admin/completions?${params}`)
        .then((data) => {
          setItems((prev) => (nextOffset === 0 ? data.completions : [...prev, ...data.completions]));
          setTotal(data.total);
          setOffset(nextOffset);
          setError(null);
        })
        .catch((err) => setError(err.message));
    },
    [filter],
  );

  useEffect(() => {
    load(0);
  }, [load]);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function add(event) {
    event.preventDefault();
    setError(null);
    const seconds = form.duration.trim() ? parseDuration(form.duration.trim()) : 0;
    if (seconds === null) {
      setError('Duration must look like 1:23:45 or 95.');
      return;
    }
    setBusy(true);
    try {
      await post('/api/admin/completions', {
        streamer_id: Number(form.streamer_id),
        character_id: Number(form.character_id),
        completed_at: form.completed_at ? new Date(`${form.completed_at}T12:00:00Z`).toISOString() : undefined,
        duration_seconds: seconds,
        attempts_count: Number(form.attempts_count) || 1,
        note: form.note.trim() || undefined,
      });
      setForm((prev) => ({ ...prev, character_id: '', duration: '', note: '' }));
      load(0);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id) {
    setBusy(true);
    try {
      await del(`/api/admin/completions/${id}`);
      load(0);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AdminSection
        title="Add a completion"
        hint="For runs the tracker never saw. Approving a VOD does this automatically."
        error={error}
      >
        <form className="admin-form" onSubmit={add}>
          <div className="field">
            <label htmlFor="comp-streamer">Streamer</label>
            <select
              id="comp-streamer"
              value={form.streamer_id}
              onChange={set('streamer_id')}
              required
            >
              <option value="">Choose…</option>
              {streamers.map((streamer) => (
                <option key={streamer.id} value={streamer.id}>
                  {streamer.display_name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="comp-character">Fighter</label>
            <select
              id="comp-character"
              value={form.character_id}
              onChange={set('character_id')}
              required
            >
              <option value="">Choose…</option>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="comp-date">Completed on</label>
            <input id="comp-date" type="date" value={form.completed_at} onChange={set('completed_at')} />
          </div>
          <div className="field">
            <label htmlFor="comp-attempts">Attempts</label>
            <input
              id="comp-attempts"
              type="number"
              min={1}
              max={9999}
              value={form.attempts_count}
              onChange={set('attempts_count')}
            />
          </div>
          <div className="field">
            <label htmlFor="comp-duration">Time played</label>
            <input
              id="comp-duration"
              placeholder="1:23:45"
              value={form.duration}
              onChange={set('duration')}
            />
          </div>
          <div className="field">
            <label htmlFor="comp-note">Note</label>
            <input id="comp-note" value={form.note} onChange={set('note')} maxLength={500} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            Add completion
          </button>
        </form>
      </AdminSection>

      <AdminSection
        title={`Completions (${total})`}
        error={error}
        actions={
          <>
            <label className="field field-inline">
              <span>Streamer</span>
              <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option value="">all</option>
                {streamers.map((streamer) => (
                  <option key={streamer.id} value={streamer.id}>
                    {streamer.display_name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-sm" onClick={() => load(0)}>
              Refresh
            </button>
          </>
        }
      >
        {items.length === 0 ? (
          <p className="muted">No completions recorded.</p>
        ) : (
          <AdminTable head={['Fighter', 'Streamer', 'Completed', 'Attempts', 'Time', '']}>
            {items.map((row) => (
              <tr key={row.id}>
                <td>{row.character.name}</td>
                <td>{row.streamer_name}</td>
                <td className="muted">{formatDateTime(row.completed_at)}</td>
                <td>{row.attempts_count}</td>
                <td className="muted">{formatDuration(row.duration_seconds)}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={busy}
                    onClick={() => revoke(row.id)}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </AdminTable>
        )}
        {items.length < total ? (
          <button type="button" className="btn" onClick={() => load(offset + 50)}>
            Load more
          </button>
        ) : null}
      </AdminSection>
    </>
  );
}
