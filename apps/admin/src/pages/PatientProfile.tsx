import { Link, useNavigate, useParams } from 'react-router-dom';
import { dateTime, Loading, prettyDate, rupee, StatePill, useAuth, useLoad } from '../lib';

type Profile = {
  id: string; phone: string; name: string | null; language: string; createdAt: string; pushDevices: number; paid: number;
  family: { id: string; name: string; age: number; gender: string; relation: string | null; isSelf: boolean; removed: boolean }[];
  bookings: { id: string; number: number; state: string; patientName: string; date: string; time: string; doctor: string; chamber: string; amount: number | null }[];
  notifications: { id: string; kind: string; title: string; body: string; read: boolean; createdAt: string }[];
};

const G: Record<string, string> = { MALE: 'Male', FEMALE: 'Female', OTHER: 'Other' };

export default function PatientProfile() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const { data: p, error } = useLoad<Profile>(`/admin/patients/${id}`);
  if (!p) return <Loading error={error} loading />;
  return (
    <>
      <div className="head">
        <div>
          <div className="small"><Link to="/patients">Patients</Link></div>
          <h1>{p.name ?? 'No name yet'}</h1>
          <div className="sub num">{p.phone}, joined {dateTime(p.createdAt)}</div>
        </div>
        {can('MANAGER') ? <button className="btn primary" onClick={() => nav(`/messages?patient=${p.id}&name=${encodeURIComponent(p.name ?? p.phone)}`)}>Send a message</button> : null}
      </div>
      <div className="grid3" style={{ marginBottom: 16 }}>
        <div className="card stat dark"><div className="v">{p.bookings.length}</div><div className="l">Serials booked</div></div>
        <div className="card stat"><div className="v">{rupee(p.paid)}</div><div className="l">Paid online</div></div>
        <div className="card stat"><div className="v">{p.language === 'bn' ? 'বাংলা' : 'English'}</div><div className="l">App language, {p.pushDevices ? `${p.pushDevices} phone${p.pushDevices > 1 ? 's' : ''} with alerts on` : 'alerts not turned on'}</div></div>
      </div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card flush">
            <div style={{ padding: '16px 18px 4px' }}><h2>Family</h2></div>
            <table><tbody>{p.family.map((f) => (
              <tr key={f.id} style={{ opacity: f.removed ? 0.5 : 1 }}>
                <td className="strong">{f.name}{f.isSelf ? <span className="muted small"> (account holder)</span> : null}</td>
                <td>{f.age}, {G[f.gender]}</td><td className="muted">{f.relation ?? ''}{f.removed ? ' removed' : ''}</td>
              </tr>
            ))}</tbody></table>
          </div>
          <div className="card flush">
            <div style={{ padding: '16px 18px 4px' }}><h2>Notifications sent</h2></div>
            <Loading empty={p.notifications.length === 0 && 'Nothing sent yet.'} />
            {p.notifications.length ? <table><tbody>{p.notifications.map((n) => (
              <tr key={n.id}><td><div className="strong">{n.title}</div><div className="muted small">{n.body}</div></td><td className="muted small right" style={{ whiteSpace: 'nowrap' }}>{dateTime(n.createdAt)}{n.read ? '' : ', unread'}</td></tr>
            ))}</tbody></table> : null}
          </div>
        </div>
        <div className="card flush">
          <div style={{ padding: '16px 18px 4px' }}><h2>Serials</h2></div>
          <Loading empty={p.bookings.length === 0 && 'No bookings yet.'} />
          {p.bookings.length ? (
            <table>
              <thead><tr><th className="right">Serial</th><th>For</th><th>Sitting</th><th>Status</th><th className="right">Paid</th></tr></thead>
              <tbody>{p.bookings.map((b) => (
                <tr key={b.id} className="click" onClick={() => nav(`/bookings?q=${b.id.slice(0, 8)}`)}>
                  <td className="right num strong">{b.number}</td>
                  <td>{b.patientName}</td>
                  <td><div className="num">{prettyDate(b.date)}, {b.time}</div><div className="muted small">{b.doctor}, {b.chamber}</div></td>
                  <td><StatePill s={b.state} /></td>
                  <td className="right num">{rupee(b.amount)}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : null}
        </div>
      </div>
    </>
  );
}
