import { StrictMode, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import './styles.css';
import { AuthProvider, Icon, PasswordInput, ToastProvider, useAuth, useTheme } from './lib';
import Dashboard from './pages/Dashboard';
import Sittings from './pages/Sittings';
import Doctors from './pages/Doctors';
import DoctorEdit from './pages/DoctorEdit';
import Chambers from './pages/Chambers';
import ChamberEdit from './pages/ChamberEdit';
import Specialties from './pages/Specialties';
import Bookings from './pages/Bookings';
import Patients from './pages/Patients';
import Money from './pages/Money';
import Team from './pages/Team';
import Activity from './pages/Activity';
import PatientProfile from './pages/PatientProfile';
import Messages from './pages/Messages';
import Settings from './pages/Settings';

function Login() {
  const { login } = useAuth();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await login(u.trim(), p); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <img src="/admin/logo.svg" alt="MedicSeba" />
        <h1 style={{ fontSize: 26 }}>Admin</h1>
        <label className="f">Username<input className="input" value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoFocus /></label>
        <PasswordInput label="Password" value={p} onChange={setP} autoComplete="current-password" />
        {err ? <div className="err">{err}</div> : null}
        <button className="btn primary" style={{ height: 44 }} disabled={busy || !u || !p}>{busy ? 'Signing in' : 'Sign in'}</button>
      </form>
    </div>
  );
}

const NAV: { to: string; label: string; icon: string; owner?: boolean }[] = [
  { to: '/', label: 'Today', icon: 'home' },
  { to: '/sittings', label: 'Sittings', icon: 'cal' },
  { to: '/bookings', label: 'Bookings', icon: 'receipt' },
  { to: '/doctors', label: 'Doctors', icon: 'steth' },
  { to: '/chambers', label: 'Chambers', icon: 'store' },
  { to: '/specialties', label: 'Specialties', icon: 'tag' },
  { to: '/patients', label: 'Patients', icon: 'users' },
  { to: '/messages', label: 'Messages', icon: 'send' },
  { to: '/money', label: 'Money', icon: 'money' },
  { to: '/team', label: 'Team', icon: 'shield', owner: true },
  { to: '/activity', label: 'Activity', icon: 'list', owner: true },
  { to: '/settings', label: 'Settings', icon: 'gear', owner: true },
];

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const dark = theme === 'dark';
  return (
    <a href="#" role="switch" aria-checked={dark} onClick={(e) => { e.preventDefault(); setTheme(dark ? 'light' : 'dark'); }}>
      <Icon name={dark ? 'sun' : 'moon'} />{dark ? 'Light mode' : 'Dark mode'}
    </a>
  );
}

function Shell() {
  const { admin, logout, can } = useAuth();
  if (!admin) return <Login />;
  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <div className="logo"><img src="/admin/logo.svg" alt="MedicSeba" /></div>
        {NAV.filter((n) => !n.owner || can('OWNER')).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}><Icon name={n.icon} />{n.label}</NavLink>
        ))}
        <div className="grow" />
        <ThemeToggle />
        <div className="me"><b>{admin.name}</b>{admin.role.toLowerCase()}</div>
        <a href="#" onClick={(e) => { e.preventDefault(); logout(); }}><Icon name="logout" />Log out</a>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/sittings" element={<Sittings />} />
          <Route path="/bookings" element={<Bookings />} />
          <Route path="/doctors" element={<Doctors />} />
          <Route path="/doctors/:id" element={<DoctorEdit />} />
          <Route path="/chambers" element={<Chambers />} />
          <Route path="/chambers/:id" element={<ChamberEdit />} />
          <Route path="/specialties" element={<Specialties />} />
          <Route path="/patients" element={<Patients />} />
          <Route path="/patients/:id" element={<PatientProfile />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/money" element={<Money />} />
          {can('OWNER') ? <Route path="/team" element={<Team />} /> : null}
          {can('OWNER') ? <Route path="/activity" element={<Activity />} /> : null}
          {can('OWNER') ? <Route path="/settings" element={<Settings />} /> : null}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/admin">
      <ToastProvider>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
