import { useState } from 'react';
import { post } from '../../api.js';
import Dialog from '../Dialog.jsx';

/** The OBS overlay URL plus copy / regenerate controls. */
export default function OverlayLink({ token, onRegenerated }) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!token) return null;
  const url = `${window.location.origin}/overlay/${token}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not access the clipboard — copy the link manually.');
    }
  }

  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      await post('/api/tracker/overlay/regenerate');
      await onRegenerated();
      setConfirming(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card overlay-link">
      <h2>Stream overlay</h2>
      <p className="muted">
        A transparent widget for OBS (add as a browser source, 1920×1080). It updates live and needs
        no login — keep the link private.
      </p>
      <div className="overlay-url">
        <input readOnly value={url} onFocus={(event) => event.target.select()} aria-label="Overlay URL" />
        <button type="button" className="btn btn-sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="overlay-actions">
        <a className="btn btn-sm" href={`/overlay/${token}`} target="_blank" rel="noreferrer">
          Open overlay
        </a>
        <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirming(true)}>
          Regenerate…
        </button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}

      {confirming ? (
        <Dialog
          title="Regenerate overlay link?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={regenerate}>
                Regenerate
              </button>
            </>
          }
        >
          <p>
            The old URL stops working immediately. Update the browser source in OBS with the new
            link.
          </p>
        </Dialog>
      ) : null}
    </section>
  );
}
