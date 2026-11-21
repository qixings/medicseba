import { useState } from 'react';
import { api, istToday, Loading, prettyDate, StatePill, useAction, useAuth, useLoad } from '../lib';

type Row = { id: string; time: string; status: string; doctorStatus: string; tokenLimit: number; onlineLimit: number; onlineTaken: number; counterTaken: number; doctor: { id: string; name: string }; chamber: { id: string; name: string } };
type Chamber = { id: string; name: string };

export default function Sittings() {
  const { can } = useAuth();
  const [date, setDate] = useState(istToday());
  const [chamberId, setChamberId] = useState('');
  const chambers = useLoad<Chamber[]>('/admin/chambers');
  const { data, error, loading, reload } = useLoad<Row[]>(`/admin/sessions?date=${date}${chamberId ? `&chamberId=${chamberId}` : ''}`);

  return (
    <>
      <div className="head">
        <div>
          <h1>Sittings</h1>
          <div className="sub">Change the token limits of one sitting. Weekly times and limits are set on each doctor's page.</div>
        </div>
        <div className="row">
          <select className="input" value={chamberId} onChange={(e) => setChamberId(e.target.value)} aria-label="Chamber">
            <option value="">All chambers</option>
            {chambers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn" onClick={() => setDate(shift(date, -1))}>Previous day</button>
          <input className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Day" />
          <button className="btn" onClick={() => setDate(shift(date, 1))}>Next day</button>
        </div>
      </div>
      <div className="card flush">
        <div style={{ padding: '16px 18px 4px' }}><h2>{prettyDate(date)}</h2></div>
        <Loading error={error} loading={loading && !data} empty={data?.length === 0 && 'No sittings on this day.'} />
        {data?.length ? (
          <table>
            <thead><tr><th>Time</th><th>Doctor</th><th>Chamber</th><th>Status</th><th className="right">Booked online</th><th className="right">Counter</th><th>Total limit</th><th>Online limit</th><th /></tr></thead>
            <tbody>{data.map((s) => <LimitRow key={s.id} s={s} editable={can('MANAGER')} onSaved={reload} />)}</tbody>
          </table>
        ) : null}
      </div>
    </>
  );
}

function shift(d: string, by: number) { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + by); return x.toISOString().slice(0, 10); }

function LimitRow({ s, editable, onSaved }: { s: Row; editable: boolean; onSaved: () => void }) {
  const [total, setTotal] = useState(String(s.tokenLimit));
  const [online, setOnline] = useState(String(s.onlineLimit));
  const { run, busy } = useAction();
  const changed = Number(total) !== s.tokenLimit || Number(online) !== s.onlineLimit;
  const over = s.status === 'ENDED' || s.status === 'CANCELLED';
  return (
    <tr>
      <td className="num strong">{s.time}</td>
      <td>{s.doctor.name}</td>
      <td className="muted">{s.chamber.name}</td>
      <td><StatePill s={s.status} /></td>
      <td className="right num">{s.onlineTaken}</td>
      <td className="right num">{s.counterTaken}</td>
      <td><input className="input num" style={{ width: 80 }} type="number" min={1} value={total} disabled={!editable || over} onChange={(e) => setTotal(e.target.value)} aria-label="Total limit" /></td>
      <td><input className="input num" style={{ width: 80 }} type="number" min={0} value={online} disabled={!editable || over} onChange={(e) => setOnline(e.target.value)} aria-label="Online limit" /></td>
      <td className="right">
        {editable && changed ? (
          <button className="btn sm primary" disabled={busy} onClick={async () => { if (await run(() => api(`/admin/sessions/${s.id}`, { method: 'PATCH', body: { tokenLimit: Number(total), onlineLimit: Number(online) } }), 'Limits saved')) onSaved(); }}>Save</button>
        ) : null}
      </td>
    </tr>
  );
}
