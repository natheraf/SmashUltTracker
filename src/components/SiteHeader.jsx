import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function SiteHeader() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link to="/" className="brand">
          Smash<span>Ult</span>Tracker
        </Link>
        <nav className="site-nav">
          <NavLink to="/" end>
            Home
          </NavLink>
          {user ? <NavLink to="/tracker">Tracker</NavLink> : null}
          {can('review_submissions') || can('approve_streamers') ? (
            <NavLink to="/admin">Admin</NavLink>
          ) : null}
          {user ? (
            <>
              <span className="muted site-user">{user.display_name}</span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  await logout();
                  navigate('/');
                }}
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login">Log in</NavLink>
              <Link className="btn btn-sm btn-primary" to="/register">
                Register
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
