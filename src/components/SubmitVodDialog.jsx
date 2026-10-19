import { useCallback, useEffect, useState } from 'react';
import { api, post } from '../api.js';
import Dialog from './Dialog.jsx';
import Turnstile from './Turnstile.jsx';

const EMPTY = {
  character_id: '',
  youtube_url: '',
  start_timestamp: '',
  completion_date: '',
  submitter_handle: '',
  note: '',
};

/**
 * Fan VOD submission: no account needed. A submission stays pending until an
 * admin reviews it, except for admins (their own submissions are trusted and
 * published straight away).
 */
export default function SubmitVodDialog({
  streamers,
  characters,
  defaultStreamerId = null,
  onClose,
}) {
  const [config, setConfig] = useState({ turnstile_site_key: null });
  const [form, setForm] = useState(EMPTY);
  const [streamerId, setStreamerId] = useState(
    String(defaultStreamerId || streamers[0]?.id || ''),
  );
  const [captcha, setCaptcha] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    api('/api/config')
      .then(setConfig)
      .catch(() => {});
  }, []);

  const onCaptcha = useCallback((token) => setCaptcha(token), []);
  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await post('/api/submissions', {
        streamer_id: Number(streamerId),
        character_id: Number(form.character_id),
        youtube_url: form.youtube_url.trim(),
        start_timestamp: form.start_timestamp.trim() || undefined,
        completion_date: form.completion_date || undefined,
        submitter_handle: form.submitter_handle.trim() || undefined,
        note: form.note.trim() || undefined,
        turnstile_token: captcha || undefined,
      });
      setDone(result.submission);
    } catch (err) {
      const detail =
        Array.isArray(err.details) && err.details.length
          ? ` — ${err.details.map((d) => d.message).join('; ')}`
          : '';
      setError(`${err.message}${detail}`);
    } finally {
      setBusy(false);
    }
  }

  const streamerName = (id) =>
    streamers.find((entry) => entry.id === Number(id))?.display_name || 'that streamer';

  if (done) {
    return (
      <Dialog title="Submission received" onClose={onClose}>
        {done.status === 'approved' ? (
          <p className="success-text">
            Approved and published on <strong>{done.character.name}</strong>.
          </p>
        ) : (
          <p>
            Thanks — your <strong>{done.character.name}</strong> VOD for {streamerName(done.streamer_id)} is
            queued for review.
          </p>
        )}
        <p className="muted">
          It shows up in the fighter dialog as soon as an admin approves it.
        </p>
        <div className="dialog-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setForm(EMPTY);
              setDone(null);
            }}
          >
            Submit another
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Submit a VOD" onClose={onClose} wide>
      <p className="muted">
        Found a run the tracker missed? Paste the YouTube link. Add a start time so reviewers land
        on the right moment.
      </p>
      <form className="vod-form" onSubmit={onSubmit}>
        {streamers.length > 1 ? (
          <div className="field">
            <label htmlFor="vod-streamer">Streamer</label>
            <select
              id="vod-streamer"
              value={streamerId}
              onChange={(event) => setStreamerId(event.target.value)}
            >
              {streamers.map((streamer) => (
                <option key={streamer.id} value={streamer.id}>
                  {streamer.display_name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="vod-character">Fighter</label>
          <select
            id="vod-character"
            value={form.character_id}
            onChange={set('character_id')}
            required
          >
            <option value="">Choose a fighter…</option>
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name} — {character.series}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="vod-url">YouTube link</label>
          <input
            id="vod-url"
            type="url"
            placeholder="https://youtu.be/…"
            value={form.youtube_url}
            onChange={set('youtube_url')}
            maxLength={500}
            required
          />
        </div>

        <div className="vod-form-row">
          <div className="field">
            <label htmlFor="vod-start">Starts at</label>
            <input
              id="vod-start"
              placeholder="1:35"
              value={form.start_timestamp}
              onChange={set('start_timestamp')}
              maxLength={12}
            />
            <span className="field-hint muted">Optional — 1:35 or 95 seconds</span>
          </div>
          <div className="field">
            <label htmlFor="vod-date">Completed on</label>
            <input
              id="vod-date"
              type="date"
              value={form.completion_date}
              onChange={set('completion_date')}
            />
            <span className="field-hint muted">If the tracker missed it</span>
          </div>
        </div>

        <div className="field">
          <label htmlFor="vod-handle">Your handle</label>
          <input
            id="vod-handle"
            placeholder="@yourname"
            value={form.submitter_handle}
            onChange={set('submitter_handle')}
            maxLength={60}
          />
        </div>

        <div className="field">
          <label htmlFor="vod-note">Comment</label>
          <textarea
            id="vod-note"
            rows={3}
            maxLength={500}
            value={form.note}
            onChange={set('note')}
            placeholder="Anything the reviewer should know"
          />
        </div>

        <Turnstile siteKey={config.turnstile_site_key} onToken={onCaptcha} />

        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Sending…' : 'Send for review'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
