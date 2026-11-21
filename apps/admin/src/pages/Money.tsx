import { useState } from 'react';
import { api, dateTime, istToday, Loading, prettyDate, rupee, StatePill, useAction, useAuth, useLoad } from '../lib';

type Line = { chamberId: string; chamber: string; bookings: number; bookingFees: number; platformFees: number; refunds: number; amount: number };
type Saved = Line & { id: string; status: 'PENDING' | 'PAID'; reference: string | null; paidAt: string | null };
type Data = { date: string; saved: Saved[]; preview: Line[]; pendingByChamber: { chamberId: string; chamber: string; amount: number; days: number }[] };

export default function Money() {
  const { can } = useAuth();
  const [date, setDate] = useState(istToday(-1));
  const { data, error, loading, reload } = useLoad<Data>(`/admin/settlements?date=${date}`);
  const { run, busy } = useAction();
  const done = date < istToday();
  const rows: (Line & Partial<Saved>)[] = data ? (data.saved.length ? data.saved : data.preview) : [];
  const total = (k: keyof Line) => rows.reduce((n, r) => n + (r[k] as number), 0);

  return (
    <>
      <div className="head">
        <div>
          <h1>Money</h1>
          <div className="sub">Each chamber gets its booking fee for every paid online token. Days are settled automatically after midnight.</div>
        </div>
        <input className="input" type="date" value={date} max={istToday()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Day" />
      </div>

      {data?.pendingByChamber.length ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Still to pay chambers</h2>
          <div className="row" style={{ gap: 24 }}>
            {data.pendingByChamber.map((p) => (
              <div key={p.chamberId}><div className="strong num" style={{ fontSize: 22 }}>{rupee(p.amount)}</div><div className="muted small">{p.chamber}, {p.days} day{p.days > 1 ? 's' : ''}</div></div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="card flush">
        <div className="row" style={{ padding: '16px 18px 8px', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{prettyDate(date)}{data && !data.saved.length ? <span className="muted small" style={{ fontWeight: 600, marginLeft: 8 }}>{done ? 'not settled yet' : 'day not over, figures so far'}</span> : null}</h2>
          {can('MANAGER') && done && data && !data.saved.length && data.preview.length ? (
            <button className="btn primary sm" disabled={busy} onClick={async () => { if (await run(() => api('/admin/settlements/generate', { body: { date } }), 'Day settled')) void reload(); }}>Settle this day</button>
          ) : null}
        </div>
        <Loading error={error} loading={loading && !data} empty={!!data && rows.length === 0 && 'No online bookings for sittings on this day.'} />
        {rows.length ? (
          <table>
            <thead><tr><th>Chamber</th><th className="right">Paid tokens</th><th className="right">Chamber share</th><th className="right">Our service fees</th><th className="right">Refunded</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => <MoneyRow key={r.chamberId} r={r} canPay={can('OWNER')} onPaid={reload} />)}
              <tr><td className="strong">Total</td><td className="right num strong">{total('bookings')}</td><td className="right num strong">{rupee(total('amount'))}</td><td className="right num strong">{rupee(total('platformFees'))}</td><td className="right num">{rupee(total('refunds'))}</td><td /><td /></tr>
            </tbody>
          </table>
        ) : null}
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>Pay each chamber by bank or UPI, then record the transaction reference here. Later this can be paid out automatically through Razorpay Route.</p>
    </>
  );
}

function MoneyRow({ r, canPay, onPaid }: { r: Line & Partial<Saved>; canPay: boolean; onPaid: () => void }) {
  const [ref, setRef] = useState('');
  const { run, busy } = useAction();
  return (
    <tr>
      <td className="strong">{r.chamber}</td>
      <td className="right num">{r.bookings}</td>
      <td className="right num strong">{rupee(r.amount)}</td>
      <td className="right num">{rupee(r.platformFees)}</td>
      <td className="right num">{rupee(r.refunds)}</td>
      <td>{r.status ? <StatePill s={r.status} /> : null}{r.paidAt ? <div className="muted small">{dateTime(r.paidAt)}, {r.reference}</div> : null}</td>
      <td className="right">
        {r.id && r.status === 'PENDING' && canPay && r.amount > 0 ? (
          <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
            <input className="input" style={{ width: 150, height: 32 }} placeholder="UTR / reference" value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Payment reference" />
            <button className="btn sm primary" disabled={busy || ref.trim().length < 3} onClick={async () => { if (await run(() => api(`/admin/settlements/${r.id}/paid`, { body: { reference: ref.trim() } }), 'Marked paid')) onPaid(); }}>Mark paid</button>
          </div>
        ) : null}
      </td>
    </tr>
  );
}
