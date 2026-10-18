import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { useAuth } from './context/AuthContext.jsx';
import Admin from './pages/Admin.jsx';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import Overlay from './pages/Overlay.jsx';
import Register from './pages/Register.jsx';
import Tracker from './pages/Tracker.jsx';

function RequireAuth({ anyOf = null, children }) {
  const { user, loading, can } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <main className="page">
        <p className="muted">Loading…</p>
      </main>
    );
  }
  if (!user) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  if (anyOf && !anyOf.some((permission) => can(permission))) {
    return (
      <main className="page">
        <h1>Not available</h1>
        <p className="muted">Your account does not have access to this page.</p>
      </main>
    );
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/tracker" element={<Tracker />} />
        <Route
          path="/admin"
          element={
            <RequireAuth anyOf={['review_submissions', 'approve_streamers', 'manage_users']}>
              <Admin />
            </RequireAuth>
          }
        />
        <Route path="/overlay" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      {/* Outside the layout: no header, transparent background for OBS. */}
      <Route path="/overlay/:token" element={<Overlay />} />
    </Routes>
  );
}
