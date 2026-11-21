import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dayName, Drawer, Field, Loading, Pill, prettyTime, useAction, useLoad, useToast } from '../lib';

/**
 * A sitting is one doctor at one chamber on some weekdays at a time.
 * The same editor is used on the doctor page (pick the chamber) and the chamber page (pick the doctor, or add a new one).
 * On a page that is not saved yet, sittings are kept as drafts and sent along with "Add doctor" / "Add chamber".
 */

export type Sitting = {
  id: string; doctorId?: string; chamberId: string; weekdays: number[]; startTime: string; tokenLimit: number; onlineShare: number; active: boolean;
  chamber?: { id: string; name: string };
  doctor?: { id: string; name: string; specialty?: string };
};

export type NewDoctor = { name: string; degrees: string; specialtyId: string; consultFee: number };

/** A sitting not saved yet: on a new doctor or chamber page. */
export type Draft = {
  key: string; chamberId?: string; doctorId?: string; newDoctor?: NewDoctor; label: string;
  weekdays: number[]; startTime: string; tokenLimit: number; onlineShare: number;
};

type Side = 'doctor' | 'chamber';
type Chamber = { id: string; name: string };
type Doctor = { id: string; name: string; specialty: string };
type Spec = { id: string; name: string };
type Result = { result?: { kept: number; cancelled: number }; moved?: { patients: number } };

const days = (w: number[]) => (w.length === 7 ? 'Every day' : [...w].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(dayName).join(', '));

/** The list on a doctor page ("Where and when they sit") or a chamber page ("Doctors who sit here"). */
export function SittingList({ side, ownerId, saved, drafts, edit, onChange, onDrafts }: {
  side: Side;
  /** The doctor or chamber this page is about; null while it is new. */
  ownerId: string | null;
  saved: Sitting[];
  drafts: Draft[];
  edit: boolean;
  onChange: () => void;
  onDrafts: (d: Draft[]) => void;
}) {
  const [open, setOpen] = useState<Sitting | 'new' | null>(null);
  const isNew = !ownerId;
  const empty = saved.length === 0 && drafts.length === 0;
  return (
    <div className="card flush">
      <div className="row" style={{ padding: '16px 18px 4px', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{side === 'doctor' ? 'Where and when they sit' : 'Doctors who sit here'}</h2>
        {edit ? <button className="btn sm primary" onClick={() => setOpen('new')}>{side === 'doctor' ? 'Add a chamber' : 'Add a doctor'}</button> : null}
      </div>
      {empty ? <p className="muted" style={{ padding: '6px 18px 16px', margin: 0 }}>
        {side === 'doctor' ? 'Not sitting anywhere yet. Add the chamber, days and time.' : 'No doctor sits here yet. Add an existing doctor or a new one.'}
        {isNew ? ' You can do it now or after saving.' : ''}
      </p> : null}
      {!empty ? (
        <table>
          <thead><tr><th>{side === 'doctor' ? 'Chamber' : 'Doctor'}</th><th>Days</th><th>Time</th><th className="right">Serials</th><th /></tr></thead>
          <tbody>
            {saved.map((s) => (
              <tr key={s.id} className={edit ? 'click' : ''} onClick={() => edit && setOpen(s)} style={{ opacity: s.active ? 1 : 0.5 }}>
                <td className="strong">
                  {side === 'doctor'
                    ? <Link to={`/chambers/${s.chamber!.id}`} onClick={(e) => e.stopPropagation()}>{s.chamber!.name}</Link>
                    : <><Link to={`/doctors/${s.doctor!.id}`} onClick={(e) => e.stopPropagation()}>{s.doctor!.name}</Link>{s.doctor!.specialty ? <div className="muted small" style={{ fontWeight: 500 }}>{s.doctor!.specialty}</div> : null}</>}
                </td>
                <td>{days(s.weekdays)}</td>
                <td className="num">{prettyTime(s.startTime)}</td>
                <td className="right num">{s.tokenLimit}</td>
                <td className="right">{s.active ? (edit ? <span className="muted small">Edit</span> : null) : <Pill tone="plain">Paused</Pill>}</td>
              </tr>
            ))}
            {drafts.map((d) => (
              <tr key={d.key}>
                <td className="strong">{d.label}{d.newDoctor ? <div className="muted small" style={{ fontWeight: 500 }}>New doctor</div> : null}</td>
                <td>{days(d.weekdays)}</td>
                <td className="num">{prettyTime(d.startTime)}</td>
                <td className="right num">{d.tokenLimit}</td>
                <td className="right"><button className="btn sm danger" onClick={() => onDrafts(drafts.filter((x) => x.key !== d.key))}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {drafts.length ? <p className="muted small" style={{ padding: '8px 18px 14px', margin: 0 }}>Saved together with the {side === 'doctor' ? 'doctor' : 'chamber'}.</p> : null}
      {open ? (
        <SittingDrawer side={side} ownerId={ownerId} s={open === 'new' ? null : open}
          onClose={() => setOpen(null)}
          onDraft={(d) => { onDrafts([...drafts, d]); setOpen(null); }}
          onSaved={() => { setOpen(null); onChange(); }} />
      ) : null}
    </div>
  );
}

function SittingDrawer({ side, ownerId, s, onClose, onDraft, onSaved }: {
  side: Side; ownerId: string | null; s: Sitting | null; onClose: () => void; onDraft: (d: Draft) => void; onSaved: () => void;
}) {
  const chambers = useLoad<Chamber[]>(side === 'doctor' ? '/admin/chambers' : null);
  const doctors = useLoad<Doctor[]>(side === 'chamber' && !s ? '/admin/doctors' : null);
  const specs = useLoad<Spec[]>(side === 'chamber' && !s ? '/admin/specialties' : null);
  const [chamberId, setChamberId] = useState(s?.chamberId ?? '');
  const [doctorId, setDoctorId] = useState(s?.doctorId ?? s?.doctor?.id ?? '');
  const [nd, setNd] = useState<NewDoctor>({ name: 'Dr. ', degrees: '', specialtyId: '', consultFee: 0 });
  const [weekdays, setWeekdays] = useState<number[]>(s?.weekdays ?? [1, 2, 3, 4, 5, 6]);
  const [time, setTime] = useState(s?.startTime ?? '17:00');
  const [limit, setLimit] = useState(s?.tokenLimit ?? 40);
  const [share, setShare] = useState(s?.onlineShare ?? 60);
  const [active, setActive] = useState(s?.active ?? true);
  const { run, busy } = useAction();
  const toast = useToast();

  useEffect(() => { if (side === 'doctor' && !chamberId && chambers.data?.[0]) setChamberId(chambers.data[0].id); }, [side, chambers.data, chamberId]);
  useEffect(() => { if (!nd.specialtyId && specs.data?.[0]) setNd((x) => ({ ...x, specialtyId: specs.data![0].id })); }, [specs.data, nd.specialtyId]);

  const isNewDoctor = side === 'chamber' && !s && doctorId === 'new';
  const moving = !!s && side === 'doctor' && chamberId !== s.chamberId;
  const whoOk = side === 'doctor' ? !!chamberId : !!s || (isNewDoctor ? nd.name.trim().length >= 4 && nd.degrees.trim().length >= 2 && !!nd.specialtyId : !!doctorId);
  const ok = whoOk && weekdays.length > 0 && /^\d\d:\d\d$/.test(time) && limit > 0;
  const timing = { weekdays: [...weekdays].sort(), startTime: time, tokenLimit: limit, onlineShare: share };

  function report(r: Result) {
    if (r.moved) toast(r.moved.patients ? `Moved. ${r.moved.patients} booked patient${r.moved.patients > 1 ? 's were' : ' was'} told and can move their serial for free.` : 'Moved to the new chamber.');
    else if (r.result?.kept) toast(`Saved. ${r.result.kept} upcoming sitting${r.result.kept > 1 ? 's' : ''} kept as before because patients already booked.`);
    else toast('Saved');
  }

  async function save() {
    // Not saved yet: keep it as a draft on the page.
    if (!ownerId) {
      const label = side === 'doctor'
        ? chambers.data?.find((c) => c.id === chamberId)?.name ?? ''
        : isNewDoctor ? nd.name.trim() : doctors.data?.find((d) => d.id === doctorId)?.name ?? '';
      onDraft({ key: crypto.randomUUID(), label, ...(side === 'doctor' ? { chamberId } : isNewDoctor ? { newDoctor: { ...nd, name: nd.name.trim(), degrees: nd.degrees.trim() } } : { doctorId }), ...timing });
      return;
    }
    let r: Result | undefined;
    if (s) r = await run(() => api<Result>(`/admin/schedules/${s.id}`, { method: 'PATCH', body: { ...timing, active, ...(side === 'doctor' ? { chamberId } : {}) } }));
    else if (side === 'doctor') r = await run(() => api<Result>(`/admin/doctors/${ownerId}/schedules`, { body: { chamberId, ...timing } }));
    else r = await run(() => api<Result>(`/admin/chambers/${ownerId}/schedules`, { body: { ...(isNewDoctor ? { newDoctor: { ...nd, name: nd.name.trim(), degrees: nd.degrees.trim() } } : { doctorId }), ...timing } }));
    if (r) { report(r); onSaved(); }
  }

  async function remove() {
    if (!s) return;
    const who = side === 'doctor' ? `at ${s.chamber?.name}` : `of ${s.doctor?.name}`;
    if (!window.confirm(`Remove this sitting ${who}?\n\nUpcoming days are cancelled. Patients who already booked are told and can move their serial to another sitting for free. Today's sitting is left to the counter.`)) return;
    const r = await run(() => api<{ cancelled: number; patients: number }>(`/admin/schedules/${s.id}`, { method: 'DELETE' }));
    if (r) { toast(r.patients ? `Removed. ${r.patients} booked patient${r.patients > 1 ? 's were' : ' was'} told and can move for free.` : 'Sitting removed'); onSaved(); }
  }

  const title = s ? (side === 'doctor' ? 'Change sitting' : `${s.doctor?.name}`) : side === 'doctor' ? 'Add a chamber' : 'Add a doctor';
  return (
    <Drawer title={title} onClose={onClose}>
      <div className="card" style={{ display: 'grid', gap: 14 }}>
        {side === 'doctor' ? (
          <Field label="Chamber">
            <select className="input" value={chamberId} onChange={(e) => setChamberId(e.target.value)}>
              {chambers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        ) : !s ? (
          <>
            <Field label="Doctor">
              <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                <option value="">Choose a doctor</option>
                <option value="new">+ New doctor (not in the list yet)</option>
                {doctors.data?.map((d) => <option key={d.id} value={d.id}>{d.name}, {d.specialty}</option>)}
              </select>
            </Field>
            {isNewDoctor ? (
              <div className="form" style={{ padding: 12, borderRadius: 12, background: 'var(--line)' }}>
                <Field label="Name" full><input className="input" value={nd.name} onChange={(e) => setNd({ ...nd, name: e.target.value })} autoFocus /></Field>
                <Field label="Degrees"><input className="input" value={nd.degrees} onChange={(e) => setNd({ ...nd, degrees: e.target.value })} placeholder="MBBS, MD (Medicine)" /></Field>
                <Field label="Specialty">
                  <select className="input" value={nd.specialtyId} onChange={(e) => setNd({ ...nd, specialtyId: e.target.value })}>
                    {specs.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </Field>
                <Field label="Consultation fee (₹)"><input className="input" type="number" min={0} value={nd.consultFee} onChange={(e) => setNd({ ...nd, consultFee: Number(e.target.value) })} /></Field>
                <p className="muted small full" style={{ margin: 0 }}>The doctor is added to the Doctors list. Add a photo and the rest of their profile there later.</p>
              </div>
            ) : null}
          </>
        ) : null}

        {moving ? <p className="small" style={{ margin: 0, color: 'var(--warn, #9a6700)' }}>Moving stops the sitting at {s!.chamber?.name}. Patients already booked there are told and can move their serial for free.</p> : null}

        <div className="f">Days
          <div className="days">{[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <button key={d} type="button" className={`day ${weekdays.includes(d) ? 'on' : ''}`} aria-pressed={weekdays.includes(d)} onClick={() => setWeekdays(weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d])}>{dayName(d)}</button>
          ))}</div>
        </div>
        <div className="form">
          <Field label="Starts at"><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Field label="Serials per sitting"><input className="input" type="number" min={1} max={500} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></Field>
          <Field label="Share for online booking (%)"><input className="input" type="number" min={0} max={100} value={share} onChange={(e) => setShare(Number(e.target.value))} /></Field>
          <div className="f">Split<div className="muted" style={{ fontWeight: 500, paddingTop: 10 }}>{Math.floor((limit * share) / 100)} online, {limit - Math.floor((limit * share) / 100)} at the counter</div></div>
        </div>
        {s ? <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Sitting is on (untick to pause it for a while)</label> : null}
        {ownerId ? <p className="muted small" style={{ margin: 0 }}>Changes apply from tomorrow. Days that already have bookings keep their time, and their limits never go below what is booked.</p> : null}
        <button className="btn primary" onClick={save} disabled={busy || !ok}>{!ownerId ? 'Add to the list' : s ? (moving ? 'Move sitting' : 'Save') : 'Add sitting'}</button>
        {s ? <button className="btn danger" onClick={remove} disabled={busy}>Remove this sitting</button> : null}
        {side === 'chamber' && !s && doctors.loading && !doctors.data ? <Loading loading /> : null}
      </div>
    </Drawer>
  );
}
