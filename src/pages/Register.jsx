import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Turnstile from '../components/Turnstile.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const EMPTY = {
  username: '',
  display_name: '',
  password: '',
  confirm: '',
  youtube_url: '',
  twitch_url: '',
};

export default function Register() {
  const { register } = useAuth();
  const [config, setConfig] = useState({ turnstile_site_key: null });
  const [form, setForm] = useState(EMPTY);
  const [captcha, setCaptcha] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api('/api/config')
      .then(setConfig)
      .catch(() => {});
  }, []);

  const onCaptcha = useCallback((token) => setCaptcha(token), []);
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    if (!form.youtube_url.trim() && !form.twitch_url.trim()) {
      setError('Add at least one channel link (YouTube or Twitch) so viewers can find you.');
      return;
    }
    if (form.password !== form.confirm) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await register({
        username: form.username.trim(),
        display_name: form.display_name.trim(),
        password: form.password,
        youtube_url: form.youtube_url.trim() || undefined,
        twitch_url: form.twitch_url.trim() || undefined,
        turnstile_token: captcha || undefined,
      });
      setDone(true);
    } catch (err) {
      const detail = Array.isArray(err.details) && err.details.length
        ? ` — ${err.details.map((d) => d.message).join('; ')}`
        : '';
      setError(`${err.message}${detail}`);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main className="page page-narrow">
        <h1>Account created</h1>
        <div className="card">
          <p>
            An admin will review your registration. You can <Link to="/login">log in</Link> right
            away — the tracker unlocks as soon as you are approved.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="page page-narrow">
      <h1>Register as a streamer</h1>
      <p className="muted">
        Run the 50-win-streak and Ironman tracker for your own channel. Accounts are reviewed by an
        admin before the tracker unlocks.
      </p>
      <form className="card" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            autoComplete="username"
            value={form.username}
            onChange={set('username')}
            minLength={3}
            maxLength={24}
            pattern="[A-Za-z0-9_]+"
            title="Letters, numbers and underscores"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="display_name">Display name</label>
          <input
            id="display_name"
            value={form.display_name}
            onChange={set('display_name')}
            maxLength={40}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="youtube_url">YouTube channel</label>
          <input
            id="youtube_url"
            type="url"
            placeholder="https://youtube.com/@yourchannel"
            value={form.youtube_url}
            onChange={set('youtube_url')}
          />
        </div>
        <div className="field">
          <label htmlFor="twitch_url">Twitch channel</label>
          <input
            id="twitch_url"
            type="url"
            placeholder="https://twitch.tv/yourchannel"
            value={form.twitch_url}
            onChange={set('twitch_url')}
          />
        </div>
        <p className="muted">At least one channel link is required.</p>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
            minLength={8}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={set('confirm')}
            minLength={8}
            required
          />
        </div>
        <Turnstile siteKey={config.turnstile_site_key} onToken={onCaptcha} />
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </main>
  );
}
