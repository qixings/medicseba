import { useState } from 'react';
import { Link } from 'react-router-dom';
import { istToday, Loading, prettyDate, rupee, StatePill, useLoad } from '../lib';

type Dash = {
  date: string; onlineBookings: number; walkIns: number; collected: number; platformFees: number; owedToChambers: number; refunds: number;
  patients: number; newPatients: number; trend: { date: string; bookings: number }[];
  sittings: { id: string; time: string; doctor: string; chamber: string; status: string; doctorStatus: string; onlineTaken: number; onlineLimit: number; counterTaken: number; tokenLimit: number; servingNumber: number }[];
};

const DOC: Record<string, string> = { ON_TIME: 'On time', LATE: 'Late', ARRIVED: 'Arrived', BREAK: 'Break', NOT_COMING: 'Not coming', ENDED: 'Ended' };

export default function Dashboard() {
  const [date, setDate] = useState(istToday());
  const { data: d, error, loading } = useLoad<Dash>(`/admin/dashboard?date=${date}`);
  const max = Math.max(1, ...(d?.trend.map((t) => t.bookings) ?? [1]));

  return (
    <>
      <div className="head">
        <div>
          <h1>{date === istToday() ? 'Today' : prettyDate(date)}</h1>
          <div className="sub">Online bookings and money are for sittings on this day.</div>
        </div>
        <input className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Day" />
      </div>
      <Loading error={error} loading={loading && !d} />
      {d ? (
        <>
          <div className="grid3">
            <div className="card stat dark"><div className="v">{d.onlineBookings}</div><div className="l">Online bookings</div></div>
            <div className="card stat"><div className="v">{d.walkIns}</div><div className="l">Counter tokens</div></div>
            <div className="card stat"><div className="v">{rupee(d.collected)}</div><div className="l">Collected online</div></div>
            <div className="card stat"><div className="v">{rupee(d.platformFees)}</div><div className="l">Our service fees</div></div>
            <div className="card stat"><div className="v">{rupee(d.owedToChambers)}</div><div className="l">Owed to chambers</div></div>
            <div className="card stat"><div className="v">{rupee(d.refunds)}</div><div className="l">Refunded</div></div>
          </div>

          <div className="grid2" style={{ marginTop: 16 }}>
            <div className="card">
              <h2>Online bookings, last 14 days</h2>
              <div className="bars" style={{ marginTop: 24 }}>
                {d.trend.map((t) => (
                  <div key={t.date} className={t.date === d.date ? 'today' : ''} style={{ height: `${(t.bookings / max) * 100}%` }} title={`${prettyDate(t.date)}: ${t.bookings}`}>
                    <span className="num">{t.bookings || ''}</span>
                  </div>
                ))}
              </div>
              <div className="barlabels">{d.trend.map((t) => <span key={t.date}>{Number(t.date.slice(8))}</span>)}</div>
            </div>
            <div className="card">
              <h2>Patients</h2>
              <div className="row" style={{ gap: 28 }}>
                <div><div className="stat" style={{ padding: 0 }}><div className="v">{d.patients}</div><div className="l">Signed up</div></div></div>
                <div><div className="stat" style={{ padding: 0 }}><div className="v">{d.newPatients}</div><div className="l">New since this day</div></div></div>
              </div>
              <p className="muted" style={{ marginTop: 16 }}>Find a patient or a booking from <Link to="/patients">Patients</Link> and <Link to="/bookings">Bookings</Link>.</p>
            </div>
          </div>

          <div className="card flush" style={{ marginTop: 16 }}>
            <div style={{ padding: '16px 18px 4px' }}><h2>Sittings</h2></div>
            <Loading empty={d.sittings.length === 0 && 'No sittings on this day.'} />
            {d.sittings.length ? (
              <table>
                <thead><tr><th>Time</th><th>Doctor</th><th>Chamber</th><th>Doctor status</th><th className="right">Online</th><th className="right">Counter</th><th className="right">Serving</th><th>Booking</th></tr></thead>
                <tbody>
                  {d.sittings.map((s) => (
                    <tr key={s.id}>
                      <td className="num strong">{s.time}</td><td>{s.doctor}</td><td className="muted">{s.chamber}</td>
                      <td>{DOC[s.doctorStatus]}</td>
                      <td className="right num">{s.onlineTaken}/{s.onlineLimit}</td>
                      <td className="right num">{s.counterTaken}</td>
                      <td className="right num strong">{s.servingNumber || '-'}</td>
                      <td><StatePill s={s.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
