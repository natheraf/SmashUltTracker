import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import { formatDateTime } from '../../lib/format.js';
import AdminSection, { AdminTable } from './AdminSection.jsx';

/**
 * Everything the admin API did, with the actor attached. Append-only: the
 * server never deletes audit rows.
 */
export default function AuditPanel() {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState('');
  const [error, setError] = useState(null);

  const load = useCallback(
    (nextOffset = 0) => {
      const params = new URLSearchParams({ limit: '50', offset: String(nextOffset) });
      if (action.trim()) params.set('action', action.trim());
      return api(`/api/admin/audit?${params}`)
        .then((data) => {
          setEntries((prev) => (nextOffset === 0 ? data.entries : [...prev, ...data.entries]));
          setTotal(data.total);
          setOffset(nextOffset);
          setError(null);
        })
        .catch((err) => setError(err.message));
    },
    [action],
  );

  useEffect(() => {
    load(0);
  }, [load]);

  return (
    <AdminSection
      title={`Audit log (${total})`}
      hint="Approvals, role changes, completion edits and vote resets."
      error={error}
      actions={
        <>
          <label className="field field-inline">
            <span>Action</span>
            <input
              type="search"
              value={action}
              onChange={(event) => setAction(event.target.value)}
              placeholder="e.g. submission"
            />
          </label>
          <button type="button" className="btn btn-sm" onClick={() => load(0)}>
            Refresh
          </button>
        </>
      }
    >
      {entries.length === 0 ? (
        <p className="muted">Nothing logged yet.</p>
      ) : (
        <AdminTable head={['When', 'Who', 'Action', 'Target', 'Detail']}>
          {entries.map((row) => (
            <tr key={row.id}>
              <td className="muted">{formatDateTime(row.created_at)}</td>
              <td>{row.actor_name || row.actor_username || '—'}</td>
              <td>
                <code>{row.action}</code>
              </td>
              <td className="muted">
                {row.target_type ? `${row.target_type} #${row.target_id ?? '—'}` : '—'}
              </td>
              <td className="muted admin-detail">
                {row.detail ? JSON.stringify(row.detail) : '—'}
              </td>
            </tr>
          ))}
        </AdminTable>
      )}
      {entries.length < total ? (
        <button type="button" className="btn" onClick={() => load(offset + 50)}>
          Load more
        </button>
      ) : null}
    </AdminSection>
  );
}
