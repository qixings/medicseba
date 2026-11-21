import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loading, Pill, useAuth, useLoad } from '../lib';

export type DoctorRow = { id: string; name: string; photoUrl: string | null; degrees: string; specialty: string; experienceYears: number; visible: boolean; schedules: number; ratingCount: number };

export default function Doctors() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const { data, error, loading } = useLoad<DoctorRow[]>(`/admin/doctors${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
  return (
    <>
      <div className="head">
        <div><h1>Doctors</h1><div className="sub">Profile, photo, and the weekly times they sit at each chamber.</div></div>
        <div className="row">
          <input className="input" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search doctors" />
          {can('MANAGER') ? <button className="btn primary" onClick={() => nav('/doctors/new')}>Add doctor</button> : null}
        </div>
      </div>
      <div className="card flush">
        <Loading error={error} loading={loading && !data} empty={data?.length === 0 && 'No doctors yet.'} />
        {data?.length ? (
          <table>
            <thead><tr><th style={{ width: 56 }} /><th>Name</th><th>Specialty</th><th className="right">Experience</th><th className="right">Weekly sittings</th><th>Shown to patients</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id} className="click" onClick={() => nav(`/doctors/${d.id}`)}>
                  <td><Avatar name={d.name} photo={d.photoUrl} /></td>
                  <td><div className="strong">{d.name}</div><div className="muted small">{d.degrees}</div></td>
                  <td>{d.specialty}</td>
                  <td className="right num">{d.experienceYears} yrs</td>
                  <td className="right num">{d.schedules || <Pill tone="warn">None</Pill>}</td>
                  <td>{d.visible ? <Pill tone="good">Shown</Pill> : <Pill tone="plain">Hidden</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </>
  );
}

export function Avatar({ name, photo, size = 40 }: { name: string; photo: string | null; size?: number }) {
  const initials = name.replace(/^Dr\.?\s+/i, '').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  return photo
    ? <img src={photo} alt="" style={{ width: size, height: size, borderRadius: 12, objectFit: 'cover', objectPosition: 'top', background: 'var(--tint)' }} />
    : <div style={{ width: size, height: size, borderRadius: 12, background: 'var(--tint)', color: 'var(--link)', display: 'grid', placeItems: 'center', fontWeight: 800 }}>{initials}</div>;
}
