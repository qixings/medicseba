import { useEffect, useState } from 'react';
import { dateTime, Loading, useLoad } from '../lib';

type Row = { id: string; phone: string; name: string | null; createdAt: string; bookings: number };

export default function Patients() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => { const id = setTimeout(() => setQuery(q.trim()), 350); return () => clearTimeout(id); }, [q]);
  const { data, error, loading } = useLoad<Row[]>(`/admin/patients${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  return (
    <>
      <div className="head">
        <div><h1>Patients</h1><div className="sub">People who signed up in the app. Newest first.</div></div>
        <input className="input" style={{ width: 260 }} placeholder="Phone or name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search patients" />
      </div>
      <div className="card flush">
        <Loading error={error} loading={loading && !data} empty={data?.length === 0 && 'Nobody matches.'} />
        {data?.length ? (
          <table>
            <thead><tr><th>Name</th><th>Phone</th><th className="right">Bookings</th><th>Signed up</th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id}><td className="strong">{p.name ?? <span className="muted">Not set</span>}</td><td className="num">{p.phone}</td><td className="right num">{p.bookings}</td><td className="muted">{dateTime(p.createdAt)}</td></tr>
            ))}</tbody>
          </table>
        ) : null}
      </div>
    </>
  );
}
