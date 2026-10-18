import { useState } from 'react';
import { patch } from '../../api.js';
import { useAuth } from '../../context/AuthContext.jsx';

/** Shown while a streamer account waits for admin approval. */
export default function PendingPanel() {
  const { user, refresh, logout } = useAuth();
  const [form, setForm] = useState({
    display_name: user.display_name || '',
    youtube_url: user.youtube_url || '',
    twitch_url: user.twitch_url || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await patch('/api/auth/me', {
        display_name: form.display_name.trim(),
        youtube_url: form.youtube_url.trim() || undefined,
        twitch_url: form.twitch_url.trim() || undefined,
      });
      await refresh();
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page page-narrow">
      <h1>Almost there</h1>
      <div className="card">
        <p>
          <span className="badge">pending review</span>
        </p>
        <p>
          Your account (<strong>{user.username}</strong>) is waiting for an admin to approve it. The
          tracker unlocks right after approval — no need to register again.
        </p>
        <p className="muted">
          Meanwhile, you can make sure your profile is right. Viewers will see this name and your
          channel links.
        </p>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="pending-name">Display name</label>
            <input
              id="pending-name"
              value={form.display_name}
              onChange={(event) => setForm({ ...form, display_name: event.target.value })}
              maxLength={40}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="pending-youtube">YouTube channel</label>
            <input
              id="pending-youtube"
              type="url"
              value={form.youtube_url}
              onChange={(event) => setForm({ ...form, youtube_url: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="pending-twitch">Twitch channel</label>
            <input
              id="pending-twitch"
              type="url"
              value={form.twitch_url}
              onChange={(event) => setForm({ ...form, twitch_url: event.target.value })}
            />
          </div>
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
          {saved ? <p className="success-text">Profile saved.</p> : null}
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save profile'}
            </button>
            <button className="btn" type="button" onClick={logout}>
              Log out
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
