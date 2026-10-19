import { useCallback, useEffect, useState } from 'react';
import { api, post } from '../api.js';
import AuditPanel from '../components/admin/AuditPanel.jsx';
import CharactersPanel from '../components/admin/CharactersPanel.jsx';
import CompletionsPanel from '../components/admin/CompletionsPanel.jsx';
import StreamersPanel from '../components/admin/StreamersPanel.jsx';
import SubmissionsQueue from '../components/admin/SubmissionsQueue.jsx';
import UsersPanel from '../components/admin/UsersPanel.jsx';
import VotesPanel from '../components/admin/VotesPanel.jsx';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Admin panel. Tabs are permission-gated on the client (and every endpoint is
 * gated again on the server), so a reviewer never sees buttons they cannot use.
 */
const TABS = [
  { id: 'submissions', label: 'Submissions', permission: 'review_submissions', count: 'pending_submissions' },
  { id: 'streamers', label: 'Streamers', permission: 'approve_streamers', count: 'pending_streamers' },
  { id: 'users', label: 'Users & roles', permission: 'manage_users' },
  { id: 'completions', label: 'Completions', permission: 'revoke_completions' },
  { id: 'votes', label: 'Votes', permission: 'manage_users' },
  { id: 'characters', label: 'Fighters', permission: 'manage_characters' },
  { id: 'audit', label: 'Audit log', permission: 'manage_users' },
];

export default function Admin() {
  const { can } = useAuth();
  const visibleTabs = TABS.filter((tab) => can(tab.permission));
  const [tab, setTab] = useState(visibleTabs[0]?.id ?? null);
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);

  const loadOverview = useCallback(() => {
    api('/api/admin/overview')
      .then((data) => {
        setOverview(data);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const setPrimary = useCallback(
    (userId) => {
      post('/api/admin/settings/primary-streamer', { user_id: userId })
        .then(() => loadOverview())
        .catch((err) => setError(err.message));
    },
    [loadOverview],
  );

  if (visibleTabs.length === 0) {
    return (
      <main className="page">
        <h1>Admin</h1>
        <p className="muted">Your account has no admin permissions.</p>
      </main>
    );
  }

  const counts = overview?.counts || {};
  const stats = [
    { label: 'Pending VODs', value: counts.pending_submissions },
    { label: 'Pending signups', value: counts.pending_streamers },
    { label: 'Votes today', value: counts.votes_today },
    { label: 'Completions', value: counts.completions },
    { label: 'Accounts', value: counts.users },
  ];

  return (
    <main className="page admin-page">
      <div className="tracker-head">
        <div>
          <h1>Admin</h1>
          <p className="muted">Review submissions, accounts, completions and the daily vote.</p>
        </div>
        <button type="button" className="btn btn-sm" onClick={loadOverview}>
          Refresh
        </button>
      </div>

      <div className="stat-grid admin-stats">
        {stats.map((stat) => (
          <div className="stat" key={stat.label}>
            <span className="stat-label">{stat.label}</span>
            <span className="stat-value">{stat.value ?? '—'}</span>
          </div>
        ))}
      </div>

      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}

      <div className="tabs" role="tablist" aria-label="Admin sections">
        {visibleTabs.map((entry) => {
          const badge = entry.count ? counts[entry.count] : 0;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={tab === entry.id ? 'tab is-active' : 'tab'}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
              {badge > 0 ? <span className="badge badge-pending">{badge}</span> : null}
            </button>
          );
        })}
      </div>

      {tab === 'submissions' ? <SubmissionsQueue /> : null}
      {tab === 'streamers' ? (
        <StreamersPanel
          primaryStreamerId={overview?.primary_streamer_id ?? null}
          onSetPrimary={setPrimary}
          canManageUsers={can('manage_users')}
        />
      ) : null}
      {tab === 'users' ? <UsersPanel /> : null}
      {tab === 'completions' ? <CompletionsPanel /> : null}
      {tab === 'votes' ? <VotesPanel /> : null}
      {tab === 'characters' ? <CharactersPanel /> : null}
      {tab === 'audit' ? <AuditPanel /> : null}
    </main>
  );
}
