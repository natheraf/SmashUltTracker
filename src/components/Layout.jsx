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
      </footer>
    </>
  );
}
