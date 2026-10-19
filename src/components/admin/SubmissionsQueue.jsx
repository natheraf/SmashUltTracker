import { useCallback, useEffect, useState } from 'react';
import { api, post } from '../../api.js';
import { formatDateTime, timeAgo } from '../../lib/format.js';
import AdminSection from './AdminSection.jsx';

const STATUSES = ['pending', 'approved', 'rejected', 'all'];

function VodPreview({ sub }) {
  const start = Number(sub.start_timestamp) > 0 ? Number(sub.start_timestamp) : null;
  const src = `https://www.youtube-nocookie.com/embed/${sub.video_id}${start ? `?start=${start}` : ''}`;
  return (
    <div className="vod-frame">
      <iframe
        src={src}
        title={sub.title || `Video ${sub.video_id}`}
        loading="lazy"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

/**
 * The VOD review queue. Rows expand into an embedded player, selections can be
 * approved or rejected in bulk, and A / R / Escape work as shortcuts so a long
 * queue can be cleared without reaching for the mouse.
 */
export default function SubmissionsQueue() {
  const [status, setStatus] = useState('pending');
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [expanded, setExpanded] = useState(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    return api(`/api/admin/submissions?status=${status}&limit=50`)
      .then((data) => {
        setItems(data.submissions);
        setSelected(new Set());
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(id, action) {
    setBusy(true);
    try {
      await post(`/api/admin/submissions/${id}/${action}`, { note: note.trim() || undefined });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function bulk(action) {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true);
    try {
      const result = await post('/api/admin/submissions/bulk', {
        ids,
        action,
        note: note.trim() || undefined,
      });
      const failed = result.results.filter((row) => row.error);
      if (failed.length) {
        setError(`${failed.length} of ${ids.length} could not be reviewed: ${failed[0].message}`);
      } else {
        setError(null);
      }
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Keyboard shortcuts: A/R act on the selection, Escape clears it. Typing in a
  // field never triggers them.
  useEffect(() => {
    const onKey = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.key === 'Escape') {
        setSelected(new Set());
        return;
      }
      if (!selected.size) return;
      if (event.key === 'a' || event.key === 'A') {
        event.preventDefault();
        bulk('approve');
      }
      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        bulk('reject');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, note]);

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = items.length > 0 && items.every((sub) => selected.has(sub.id));

  return (
    <AdminSection
      title="VOD submissions"
      hint="Approving a VOD publishes it on the fighter page — and records the completion when the fighter has none."
      error={error}
      actions={
        <>
          <label className="field field-inline">
            <span>Queue</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-sm" onClick={load}>
            Refresh
          </button>
        </>
      }
    >
      <div className="admin-toolbar">
        <label className="check">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(event) =>
              setSelected(event.target.checked ? new Set(items.map((sub) => sub.id)) : new Set())
            }
          />
          Select all
        </label>
        <input
          type="search"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Review note (optional)"
          aria-label="Review note"
        />
        <div className="row">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!selected.size || busy}
            onClick={() => bulk('approve')}
          >
            Approve selected{selected.size ? ` (${selected.size})` : ''}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            disabled={!selected.size || busy}
            onClick={() => bulk('reject')}
          >
            Reject selected
          </button>
        </div>
        <span className="muted admin-shortcuts">
          shortcuts: <kbd>A</kbd> approve · <kbd>R</kbd> reject · <kbd>Esc</kbd> clear
        </span>
      </div>

      {items.length === 0 ? (
        <p className="muted">Nothing in this queue.</p>
      ) : (
        <ul className="admin-list">
          {items.map((sub) => (
            <li key={sub.id} className={selected.has(sub.id) ? 'admin-item is-selected' : 'admin-item'}>
              <div className="admin-item-main">
                <input
                  type="checkbox"
                  checked={selected.has(sub.id)}
                  onChange={() => toggle(sub.id)}
                  aria-label={`Select submission for ${sub.character.name}`}
                />
                <button
                  type="button"
                  className="admin-item-thumb"
                  onClick={() => setExpanded(expanded === sub.id ? null : sub.id)}
                  aria-expanded={expanded === sub.id}
                  title="Preview the video"
                >
                  {sub.thumbnail ? <img src={sub.thumbnail} alt="" loading="lazy" /> : null}
                </button>
                <div className="admin-item-body">
                  <p className="admin-item-title">
                    <a href={sub.youtube_url} target="_blank" rel="noreferrer noopener">
                      {sub.title || sub.video_id}
                    </a>
                  </p>
                  <p className="muted">
                    {sub.streamer_name} · {sub.character.name}
                    {sub.start_timestamp ? ` · starts at ${sub.start_timestamp}s` : ''}
                    {sub.completion_date ? ` · completed ${sub.completion_date}` : ''}
                  </p>
                  {sub.note ? <p className="admin-item-note">{sub.note}</p> : null}
                  {sub.submitter_handle ? (
                    <p className="muted">from {sub.submitter_handle}</p>
                  ) : null}
                </div>
                <div className="admin-item-side">
                  <span className={`badge badge-${sub.status}`}>{sub.status}</span>
                  <span className="muted">{timeAgo(sub.created_at)}</span>
                  {sub.status === 'pending' ? (
                    <div className="row">
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={busy}
                        onClick={() => decide(sub.id, 'approve')}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={busy}
                        onClick={() => decide(sub.id, 'reject')}
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <span className="muted">
                      reviewed {sub.reviewed_at ? formatDateTime(sub.reviewed_at) : ''}
                      {sub.review_note ? ` — ${sub.review_note}` : ''}
                    </span>
                  )}
                </div>
              </div>
              {expanded === sub.id ? (
                <div className="admin-item-preview">
                  <VodPreview sub={sub} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </AdminSection>
  );
}
