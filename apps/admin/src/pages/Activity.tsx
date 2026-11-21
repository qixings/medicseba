import { dateTime, Loading, useLoad } from '../lib';

type Row = { id: string; admin: string; action: string; target: string | null; data: Record<string, unknown>; createdAt: string };

const TEXT: Record<string, string> = {
  'doctor.create': 'Added a doctor', 'doctor.update': 'Changed a doctor', 'doctor.photo': 'Uploaded a doctor photo',
  'chamber.create': 'Added a chamber', 'chamber.update': 'Changed a chamber', 'agent.create': 'Added a counter login', 'agent.update': 'Changed a counter login',
  'schedule.create': 'Added a sitting time', 'schedule.update': 'Changed a sitting time', 'session.limits': 'Changed sitting limits',
  'booking.refund': 'Refunded a booking', 'settlement.generate': 'Settled a day', 'settlement.paid': 'Paid a chamber',
  'specialty.create': 'Added a specialty', 'specialty.update': 'Changed a specialty', 'team.create': 'Added a team member', 'team.update': 'Changed a team member',
};

function summary(d: Record<string, unknown>) {
  return Object.entries(d).filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object').map(([k, v]) => `${k}: ${String(v)}`).join(', ').slice(0, 140);
}

export default function Activity() {
  const { data, error, loading } = useLoad<Row[]>('/admin/audit');
  return (
    <>
      <div className="head"><div><h1>Activity</h1><div className="sub">The last 200 changes made in the admin panel.</div></div></div>
      <div className="card flush">
        <Loading error={error} loading={loading && !data} empty={data?.length === 0 && 'Nothing changed yet.'} />
        {data?.length ? (
          <table>
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id}><td className="muted" style={{ whiteSpace: 'nowrap' }}>{dateTime(r.createdAt)}</td><td className="strong">{r.admin}</td><td>{TEXT[r.action] ?? r.action}</td><td className="muted small">{summary(r.data)}</td></tr>
            ))}</tbody>
          </table>
        ) : null}
      </div>
    </>
  );
}
