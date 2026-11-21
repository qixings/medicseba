import { useEffect, useState } from 'react';
import { api, dateTime, Drawer, Field, Loading, prettyDate, rupee, StatePill, useAction, useAuth, useLoad } from '../lib';

type Row = { id: string; number: number; state: string; source: 'ONLINE' | 'WALKIN'; patientName: string; patientAge: number | null; phone: string | null; date: string; time: string; doctor: string; chamber: string; amount: number | null; paymentStatus: string | null; createdAt: string };
type Detail = {
  token: { id: string; number: number; state: string; source: string; patientName: string; patientAge: number | null; patientGender: string | null; rescheduleUsed: boolean; createdAt: string; servedAt: string | null; doneAt: string | null };
  session: { date: string; time: string; status: string; doctorStatus: string };
  doctor: { name: string }; chamber: { name: string };
  patient: { phone: string; name: string | null } | null;
  payment: { amount: number; bookingFee: number; platformFee: number; status: string; provider: string; providerOrderId: string; providerPaymentId: string | null; providerRefundId: string | null; createdAt: string } | null;
};
type Chamber = { id: string; name: string };

export default function Bookings() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [date, setDate] = useState('');
  const [chamberId, setChamberId] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { const id = setTimeout(() => setQuery(q.trim()), 350); return () => clearTimeout(id); }, [q]);
  const chambers = useLoad<Chamber[]>('/admin/chambers');
  const params = new URLSearchParams({ ...(query ? { q: query } : {}), ...(date ? { date } : {}), ...(chamberId ? { chamberId } : {}) }).toString();
  const { data, error, loading, reload } = useLoad<Row[]>(`/admin/bookings${params ? `?${params}` : ''}`);

  return (
    <>
      <div className="head">
        <div><h1>Bookings</h1><div className="sub">Find a token by phone number, patient name or booking ID.</div></div>
        <div className="row">
          <input className="input" style={{ width: 240 }} placeholder="Phone, name or ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Day" />
          <select className="input" value={chamberId} onChange={(e) => setChamberId(e.target.value)} aria-label="Chamber">
            <option value="">All chambers</option>{chambers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div className="card flush">
        <Loading error={error} loading={loading && !data} empty={data?.length === 0 && 'No booking matches.'} />
        {data?.length ? (
          <table>
            <thead><tr><th className="right">Token</th><th>Patient</th><th>Phone</th><th>Sitting</th><th>Doctor, chamber</th><th>Status</th><th className="right">Paid</th></tr></thead>
            <tbody>{data.map((b) => (
              <tr key={b.id} className="click" onClick={() => setOpen(b.id)}>
                <td className="right num strong" style={{ fontSize: 16 }}>{b.number}</td>
                <td><div className="strong">{b.patientName}</div><div className="muted small">{b.source === 'ONLINE' ? 'Online' : 'Counter'}{b.patientAge ? `, ${b.patientAge}` : ''}</div></td>
                <td className="num">{b.phone ?? '-'}</td>
                <td className="num">{prettyDate(b.date)}, {b.time}</td>
                <td><div>{b.doctor}</div><div className="muted small">{b.chamber}</div></td>
                <td><StatePill s={b.state} /></td>
                <td className="right num">{b.amount != null ? <>{rupee(b.amount)} {b.paymentStatus === 'REFUNDED' ? <span className="muted small">refunded</span> : null}</> : '-'}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : null}
      </div>
      {open ? <BookingDrawer id={open} onClose={() => setOpen(null)} onChanged={() => { void reload(); }} /> : null}
    </>
  );
}

function BookingDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useAuth();
  const { data: d, error, reload } = useLoad<Detail>(`/admin/bookings/${id}`);
  const [reason, setReason] = useState('');
  const { run, busy } = useAction();
  return (
    <Drawer title={d ? `Token ${d.token.number}` : 'Booking'} onClose={onClose}>
      <Loading error={error} loading={!d && !error} />
      {d ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="card" style={{ background: 'var(--night)', color: '#fff', borderColor: 'var(--night)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div style={{ fontSize: 56, fontWeight: 900, letterSpacing: -2, lineHeight: 1 }} className="num">{d.token.number}</div>
              <StatePill s={d.token.state} />
            </div>
            <div className="strong" style={{ marginTop: 10, fontSize: 16 }}>{d.token.patientName}{d.token.patientAge ? `, ${d.token.patientAge}` : ''}</div>
            <div style={{ opacity: 0.75 }}>{d.doctor.name}, {d.chamber.name}</div>
            <div style={{ color: 'var(--brand)', fontWeight: 800, marginTop: 4 }} className="num">{prettyDate(d.session.date)}, {d.session.time}</div>
          </div>
          <div className="card">
            <table><tbody>
              <tr><td className="muted">Booked by</td><td className="right num">{d.patient ? `${d.patient.name ?? ''} ${d.patient.phone}` : 'At the counter'}</td></tr>
              <tr><td className="muted">Booked at</td><td className="right">{dateTime(d.token.createdAt)}</td></tr>
              {d.token.servedAt ? <tr><td className="muted">Called in</td><td className="right">{dateTime(d.token.servedAt)}</td></tr> : null}
              <tr><td className="muted">Free reschedule</td><td className="right">{d.token.rescheduleUsed ? 'Used' : 'Not used'}</td></tr>
              <tr><td className="muted">Booking ID</td><td className="right small num">{d.token.id}</td></tr>
            </tbody></table>
          </div>
          {d.payment ? (
            <div className="card">
              <h2>Payment</h2>
              <table><tbody>
                <tr><td className="muted">Paid</td><td className="right num strong">{rupee(d.payment.amount)} <StatePill s={d.payment.status} /></td></tr>
                <tr><td className="muted">Chamber share</td><td className="right num">{rupee(d.payment.bookingFee)}</td></tr>
                <tr><td className="muted">Service fee</td><td className="right num">{rupee(d.payment.platformFee)}</td></tr>
                <tr><td className="muted">Provider</td><td className="right">{d.payment.provider}</td></tr>
                <tr><td className="muted">Order</td><td className="right small num">{d.payment.providerOrderId}</td></tr>
                {d.payment.providerPaymentId ? <tr><td className="muted">Payment</td><td className="right small num">{d.payment.providerPaymentId}</td></tr> : null}
                {d.payment.providerRefundId ? <tr><td className="muted">Refund</td><td className="right small num">{d.payment.providerRefundId}</td></tr> : null}
              </tbody></table>
            </div>
          ) : null}
          {d.payment?.status === 'PAID' && can('MANAGER') ? (
            <div className="card" style={{ display: 'grid', gap: 10 }}>
              <h2 style={{ margin: 0 }}>Full refund</h2>
              <p className="muted small" style={{ margin: 0 }}>Returns {rupee(d.payment.amount)} to the patient and frees the place if the sitting is still ahead. The patient gets a notification. This cannot be undone.</p>
              <Field label="Reason (kept in the activity log)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Patient could not come, called support" /></Field>
              <button className="btn danger" disabled={busy || reason.trim().length < 3} onClick={async () => {
                if (!window.confirm(`Refund ${rupee(d.payment!.amount)} for token ${d.token.number}?`)) return;
                if (await run(() => api(`/admin/bookings/${id}/refund`, { body: { reason } }), 'Refund started')) { void reload(); onChanged(); }
              }}>Refund {rupee(d.payment.amount)}</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
