import { useCallback, useEffect, useState } from 'react';
import { api, post } from '../../api.js';
import { timeAgo } from '../../lib/format.js';
import AdminSection from './AdminSection.jsx';

/**
 * Registrations waiting for approval, plus the approved streamer list with the
 * "primary" flag — the featured streamer is the one the home page, the share
 * card and the vote ballot follow.
 */
export default function StreamersPanel({ primaryStreamerId, onSetPrimary, canManageUsers }) {
  const [pending, setPending] = useState([]);
  const [streamers, setStreamers] = useState([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api('/api/admin/streamers')
      .then((data) => {
        setPending(data.streamers);
        setError(null);
      })
      .catch((err) => setError(err.message));
    if (canManageUsers) {
      api('/api/admin/users?status=approved&role=streamer&limit=100')
        .then((data) => setStreamers(data.users))
        .catch(() => {});
    }
  }, [canManageUsers]);

  useEffect(() => {
    load();
  }, [load]);

  async function review(id, action) {
    setBusy(true);
    try {
      await post(`/api/admin/streamers/${id}/${action}`, { note: note.trim() || undefined });
      setNote('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AdminSection
        title="Pending registrations"
        hint="Approved accounts get the streamer role and can run the tracker."
        error={error}
        actions={
          <button type="button" className="btn btn-sm" onClick={load}>
            Refresh
          </button>
        }
      >
        {pending.length === 0 ? (
          <p className="muted">No registrations waiting for review.</p>
        ) : (
          <ul className="admin-list">
            {pending.map((user) => (
              <li key={user.id} className="admin-item">
                <div className="admin-item-main">
                  <div className="admin-item-body">
                    <p className="admin-item-title">
                      {user.display_name} <span className="muted">@{user.username}</span>
                    </p>
                    <p className="muted">
                      {user.youtube_url || ''}
                      {user.youtube_url && user.twitch_url ? ' · ' : ''}
                      {user.twitch_url || ''}
                    </p>
                    <p className="muted">registered {timeAgo(user.created_at)}</p>
                  </div>
                  <div className="admin-item-side">
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={busy}
                      onClick={() => review(user.id, 'approve')}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={busy}
                      onClick={() => review(user.id, 'reject')}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="field">
          <label htmlFor="streamer-note">Review note</label>
          <input
            id="streamer-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            placeholder="Optional — recorded in the audit log"
          />
        </div>
      </AdminSection>

      {canManageUsers ? (
        <AdminSection
          title="Primary streamer"
          hint="The featured streamer: first card on the home page, subject of the share card and the vote ballot."
        >
          {streamers.length === 0 ? (
            <p className="muted">Approve a streamer first.</p>
          ) : (
            <ul className="admin-list">
              {streamers.map((user) => (
                <li key={user.id} className="admin-item">
                  <div className="admin-item-main">
                    <div className="admin-item-body">
                      <p className="admin-item-title">
                        {user.display_name} <span className="muted">@{user.username}</span>
                      </p>
                    </div>
                    <div className="admin-item-side">
                      {primaryStreamerId === user.id ? (
                        <span className="badge badge-live">primary</span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={busy}
                          onClick={() => onSetPrimary(user.id)}
                        >
                          Make primary
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </AdminSection>
      ) : null}
    </>
  );
}
