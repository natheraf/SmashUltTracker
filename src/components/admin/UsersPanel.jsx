import { useCallback, useEffect, useState } from 'react';
import { api, post } from '../../api.js';
import { timeAgo } from '../../lib/format.js';
import AdminSection, { AdminTable } from './AdminSection.jsx';

const STATUSES = ['pending', 'approved', 'rejected', 'suspended'];

/**
 * Accounts and roles. Roles are data — granting one flips permissions instantly
 * because the server reads role_permissions on every request.
 */
export default function UsersPanel() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: '100' });
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    if (role) params.set('role', role);
    api(`/api/admin/users?${params}`)
      .then((data) => {
        setUsers(data.users);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, [q, status, role]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api('/api/admin/roles')
      .then((data) => setRoles(data.roles))
      .catch(() => {});
  }, []);

  async function run(action) {
    setBusy(true);
    try {
      await action();
      setError(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const setStatusTo = (user, next) =>
    run(() => post(`/api/admin/users/${user.id}/status`, { status: next }));
  const toggleRole = (user, name, granted) =>
    run(() => post(`/api/admin/users/${user.id}/roles`, { role: name, action: granted ? 'revoke' : 'grant' }));

  return (
    <AdminSection
      title="Users"
      hint="Suspend an account to lock it out; grant roles to hand out permissions."
      error={error}
      actions={
        <>
          <label className="field field-inline">
            <span>Search</span>
            <input
              type="search"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="username or name"
            />
          </label>
          <label className="field field-inline">
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">any</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="field field-inline">
            <span>Role</span>
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="">any</option>
              {roles.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        </>
      }
    >
      {users.length === 0 ? (
        <p className="muted">No accounts match.</p>
      ) : (
        <AdminTable head={['Account', 'Status', 'Roles', 'Joined', 'Actions']}>
          {users.map((user) => (
            <tr key={user.id}>
              <td>
                <strong>{user.display_name}</strong>
                <br />
                <span className="muted">@{user.username}</span>
              </td>
              <td>
                <span className={`badge badge-${user.status}`}>{user.status}</span>
              </td>
              <td>
                <div className="role-chips">
                  {roles.map((entry) => {
                    const granted = user.roles.includes(entry.name);
                    return (
                      <button
                        key={entry.name}
                        type="button"
                        className={granted ? 'role-chip is-on' : 'role-chip'}
                        onClick={() => toggleRole(user, entry.name, granted)}
                        disabled={busy}
                        title={entry.description}
                      >
                        {entry.name}
                      </button>
                    );
                  })}
                </div>
              </td>
              <td className="muted">{timeAgo(user.created_at)}</td>
              <td>
                <div className="row">
                  {user.status !== 'approved' ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={busy}
                      onClick={() => setStatusTo(user, 'approved')}
                    >
                      Approve
                    </button>
                  ) : null}
                  {user.status === 'suspended' ? null : (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={busy}
                      onClick={() => setStatusTo(user, 'suspended')}
                    >
                      Suspend
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </AdminTable>
      )}
    </AdminSection>
  );
}
