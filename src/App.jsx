import { Route, Routes } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Tracker from './pages/Tracker.jsx';
import Admin from './pages/Admin.jsx';
import Overlay from './pages/Overlay.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/tracker" element={<Tracker />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/overlay" element={<Overlay />} />
    </Routes>
  );
}
