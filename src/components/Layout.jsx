import { Outlet } from 'react-router-dom';
import SiteHeader from './SiteHeader.jsx';

export default function Layout() {
  return (
    <>
      <SiteHeader />
      <Outlet />
      <footer className="site-footer">
        <p>
          Unofficial fan project for nairomk&apos;s 50-win streak and Ironman challenges. Not
          affiliated with or endorsed by Nintendo.
        </p>
        <p className="muted">
          Character art © Nintendo, images from SmashWiki. Code is MIT licensed.
        </p>
        <p className="muted">
          Privacy: no accounts or cookies are needed to browse, votes and submissions are counted
          with a salted hash of your IP address, and VODs play through youtube-nocookie.com.
        </p>
      </footer>
    </>
  );
}
