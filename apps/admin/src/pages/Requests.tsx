import { useState } from 'react';
import { api, dateTime, Loading, Pill, rupee, Segmented, useAction, useAuth, useLoad } from '../lib';

type Req = {
  id: string; kind: 'new_doctor' | 'doctor_update' | 'fees'; chamber: string; chamberFees: { bookingFee: number };
  data: Record<string, any>; status: string; note: string | null; createdAt: string;
  current: { name: string; degrees: string; experienceYears: number; consultFee: number; languages: string[]; bio: string } | null;
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const KIND: Record<Req['kind'], string> = { new_doctor: 'New doctor', doctor_update: 'Doctor change', fees: 'Booking fee' };

export default function Requests() {
  const { can } = useAuth();
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const { data, error, loading, reload } = useLoad<Req[]>(`/admin/requests?status=${status}`);
  return (
    <>
      <div className="head">
        <div><h1>Requests</h1><div className="sub">Changes chambers sent from the counter app. Nothing here is public until you approve it.</div></div>
        <Segmented value={status} onChange={setStatus} options={[{ value: 'PENDING', label: 'Waiting' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }]} />
      </div>
      <Loading error={error} loading={loading && !data} empty={data?.length === 0 && 'Nothing here.'} />
      <div style={{ display: 'grid', gap: 12 }}>
        {data?.map((r) => <RequestCard key={r.id} r={r} canDecide={can('MANAGER') && r.status === 'PENDING'} onDone={reload} />)}
      </div>
    </>
  );
}

function RequestCard({ r, canDecide, onDone }: { r: Req; canDecide: boolean; onDone: () => void }) {
  const { run, busy } = useAction();
  const [note, setNote] = useState('');
  const doc = r.data.doctor ?? {};
  const sit = r.data.sitting;
  // For a change, show only the fields that differ; for a new doctor, show everything filled in.
  const diff = (label: string, now: unknown, next: unknown) => (next === undefined || next === '' || (r.kind === 'doctor_update' && String(now ?? '') === String(next)) ? null : (
    <tr key={label}><td className="muted">{label}</td><td>{now === undefined || now === null ? '' : String(now)}</td><td className="strong">{String(next)}</td></tr>
  ));
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <div><Pill tone="teal">{KIND[r.kind]}</Pill> <span className="strong" style={{ marginLeft: 6 }}>{r.chamber}</span></div>
        <span className="muted small">{dateTime(r.createdAt)}{r.status !== 'PENDING' ? `, ${r.status.toLowerCase()}` : ''}</span>
      </div>
      {r.kind === 'fees' ? (
        <p style={{ margin: 0 }}>Booking fee from <b>{rupee(r.chamberFees.bookingFee)}</b> to <b>{rupee(r.data.bookingFee)}</b>. Patients would pay {rupee(r.data.bookingFee + 10)} with the service fee.</p>
      ) : (
        <table>
          <thead><tr><th /><th>{r.kind === 'doctor_update' ? 'Now' : ''}</th><th>{r.kind === 'doctor_update' ? 'Asked for' : 'Details'}</th></tr></thead>
          <tbody>
            {diff('Name', r.current?.name, doc.name)}
            {diff('Degrees', r.current?.degrees, doc.degrees)}
            {diff('Experience', r.current?.experienceYears, doc.experienceYears)}
            {diff('Consultation fee', r.current?.consultFee, doc.consultFee)}
            {diff('Languages', r.current?.languages?.join(', '), doc.languages?.join(', '))}
            {diff('About', r.current?.bio, doc.bio)}
            {sit ? diff('Sits', '', `${sit.weekdays.map((d: number) => DAYS[d]).join(', ')} at ${sit.startTime}, ${sit.tokenLimit} serials`) : null}
          </tbody>
        </table>
      )}
      {r.note ? <p className="err" style={{ marginBottom: 0 }}>Reason given: {r.note}</p> : null}
      {canDecide ? (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={busy} onClick={async () => { if (await run(() => api(`/admin/requests/${r.id}/approve`, { body: {} }), 'Approved and live')) onDone(); }}>Approve</button>
          <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Reason, if you reject (the chamber sees it)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn danger" disabled={busy || note.trim().length < 2} onClick={async () => { if (await run(() => api(`/admin/requests/${r.id}/reject`, { body: { note } }), 'Rejected')) onDone(); }}>Reject</button>
        </div>
      ) : null}
    </div>
  );
}
