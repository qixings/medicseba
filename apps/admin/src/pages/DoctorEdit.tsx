import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, dayName, Drawer, Field, Loading, Pill, prettyTime, useAction, useAuth, useLoad, useToast } from '../lib';

type Schedule = { id: string; chamberId: string; weekdays: number[]; startTime: string; tokenLimit: number; onlineShare: number; active: boolean; chamber: { id: string; name: string } };
type Doctor = {
  id: string; name: string; photoUrl: string | null; degrees: string; specialtyId: string; experienceYears: number; consultFee: number;
  languages: string[]; bio: string; bookingWindowDays: number; visible: boolean; schedules: Schedule[];
};
type Spec = { id: string; name: string };
type Chamber = { id: string; name: string };

const blank = { name: 'Dr. ', degrees: '', specialtyId: '', experienceYears: 0, consultFee: 0, languages: ['Bengali'], bio: '', bookingWindowDays: 7, visible: true };

export default function DoctorEdit() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const { can } = useAuth();
  const edit = can('MANAGER');
  const doc = useLoad<Doctor>(isNew ? null : `/admin/doctors/${id}`);
  const specs = useLoad<Spec[]>('/admin/specialties');
  const [f, setF] = useState(blank);
  const [langs, setLangs] = useState('Bengali');
  const { run, busy } = useAction();
  const [sched, setSched] = useState<Schedule | 'new' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (doc.data) {
      const d = doc.data;
      setF({ name: d.name, degrees: d.degrees, specialtyId: d.specialtyId, experienceYears: d.experienceYears, consultFee: d.consultFee, languages: d.languages, bio: d.bio, bookingWindowDays: d.bookingWindowDays, visible: d.visible });
      setLangs(d.languages.join(', '));
    }
  }, [doc.data]);
  useEffect(() => { if (isNew && !f.specialtyId && specs.data?.[0]) setF((x) => ({ ...x, specialtyId: specs.data![0].id })); }, [isNew, specs.data, f.specialtyId]);

  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    const body = { ...f, languages: langs.split(',').map((s) => s.trim()).filter(Boolean) };
    if (isNew) {
      const r = await run(() => api<{ id: string }>('/admin/doctors', { body }), 'Doctor added. Now add when they sit.');
      if (r) nav(`/doctors/${r.id}`, { replace: true });
    } else if (await run(() => api(`/admin/doctors/${id}`, { method: 'PATCH', body }), 'Saved')) void doc.reload();
  }

  async function upload(file: File) {
    const form = new FormData(); form.append('photo', file);
    if (await run(() => api(`/admin/doctors/${id}/photo`, { form }), 'Photo updated')) void doc.reload();
  }

  if (!isNew && !doc.data) return <Loading error={doc.error} loading />;
  const d = doc.data;

  return (
    <>
      <div className="head">
        <div><div className="small"><Link to="/doctors">Doctors</Link></div><h1>{isNew ? 'New doctor' : d!.name}</h1></div>
        {edit ? <button className="btn primary" onClick={save} disabled={busy || f.name.trim().length < 4 || !f.degrees.trim() || !f.specialtyId}>{isNew ? 'Add doctor' : 'Save changes'}</button> : null}
      </div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h2>Profile</h2>
          <fieldset disabled={!edit} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="form">
              <Field label="Name" full><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
              <Field label="Degrees"><input className="input" value={f.degrees} onChange={(e) => set('degrees', e.target.value)} placeholder="MBBS, MD (Medicine)" /></Field>
              <Field label="Specialty">
                <select className="input" value={f.specialtyId} onChange={(e) => set('specialtyId', e.target.value)}>
                  {specs.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Years of experience"><input className="input" type="number" min={0} value={f.experienceYears} onChange={(e) => set('experienceYears', Number(e.target.value))} /></Field>
              <Field label="Consultation fee, paid at the chamber (₹)"><input className="input" type="number" min={0} value={f.consultFee} onChange={(e) => set('consultFee', Number(e.target.value))} /></Field>
              <Field label="Languages (comma separated)"><input className="input" value={langs} onChange={(e) => setLangs(e.target.value)} /></Field>
              <Field label="Patients can book up to (days ahead)"><input className="input" type="number" min={1} max={60} value={f.bookingWindowDays} onChange={(e) => set('bookingWindowDays', Number(e.target.value))} /></Field>
              <Field label="About the doctor" full><textarea className="input" value={f.bio} onChange={(e) => set('bio', e.target.value)} maxLength={600} /></Field>
              <label className="check full"><input type="checkbox" checked={f.visible} onChange={(e) => set('visible', e.target.checked)} /> Show this doctor in the patient app</label>
            </div>
          </fieldset>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          {!isNew ? (
            <div className="card">
              <h2>Photo</h2>
              <div className="row" style={{ alignItems: 'flex-end', gap: 16 }}>
                <div className="photo">{d!.photoUrl ? <img src={d!.photoUrl} alt="" /> : <span>{d!.name.replace(/^Dr\.?\s+/, '').slice(0, 1)}</span>}</div>
                {edit ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <p className="muted small" style={{ margin: 0, maxWidth: 240 }}>A PNG with a see-through background looks best, cut out from the waist up. Up to 4 MB.</p>
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const x = e.target.files?.[0]; if (x) void upload(x); e.target.value = ''; }} />
                    <div className="row">
                      <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>{d!.photoUrl ? 'Replace photo' : 'Upload photo'}</button>
                      {d!.photoUrl ? <button className="btn danger" disabled={busy} onClick={async () => { if (await run(() => api(`/admin/doctors/${id}/photo`, { method: 'DELETE' }), 'Photo removed')) void doc.reload(); }}>Remove</button> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {!isNew ? (
            <div className="card flush">
              <div className="row" style={{ padding: '16px 18px 4px', justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0 }}>When they sit</h2>
                {edit ? <button className="btn sm primary" onClick={() => setSched('new')}>Add</button> : null}
              </div>
              <Loading empty={d!.schedules.length === 0 && 'Not sitting anywhere yet. Add a chamber, days and time.'} />
              {d!.schedules.length ? (
                <table>
                  <thead><tr><th>Chamber</th><th>Days</th><th>Time</th><th className="right">Serials</th><th className="right">Online</th><th /></tr></thead>
                  <tbody>
                    {d!.schedules.map((s) => (
                      <tr key={s.id} className={edit ? 'click' : ''} onClick={() => edit && setSched(s)} style={{ opacity: s.active ? 1 : 0.5 }}>
                        <td className="strong">{s.chamber.name}</td>
                        <td>{s.weekdays.map(dayName).join(', ')}</td>
                        <td className="num">{prettyTime(s.startTime)}</td>
                        <td className="right num">{s.tokenLimit}</td>
                        <td className="right num">{s.onlineShare}%</td>
                        <td>{s.active ? null : <Pill tone="plain">Stopped</Pill>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {sched ? <ScheduleDrawer doctorId={id!} s={sched === 'new' ? null : sched} onClose={() => setSched(null)} onSaved={() => { setSched(null); void doc.reload(); }} /> : null}
    </>
  );
}

function ScheduleDrawer({ doctorId, s, onClose, onSaved }: { doctorId: string; s: Schedule | null; onClose: () => void; onSaved: () => void }) {
  const chambers = useLoad<Chamber[]>('/admin/chambers');
  const [chamberId, setChamberId] = useState(s?.chamberId ?? '');
  const [days, setDays] = useState<number[]>(s?.weekdays ?? [1, 2, 3, 4, 5, 6]);
  const [time, setTime] = useState(s?.startTime ?? '17:00');
  const [limit, setLimit] = useState(s?.tokenLimit ?? 40);
  const [share, setShare] = useState(s?.onlineShare ?? 60);
  const [active, setActive] = useState(s?.active ?? true);
  const { run, busy } = useAction();
  const toast = useToast();
  useEffect(() => { if (!chamberId && chambers.data?.[0]) setChamberId(chambers.data[0].id); }, [chambers.data, chamberId]);

  async function save() {
    const body = { chamberId, weekdays: [...days].sort(), startTime: time, tokenLimit: limit, onlineShare: share, active };
    const r = await run(() => api<{ result: { updated: number; cancelled: number; kept: number } }>(s ? `/admin/schedules/${s.id}` : `/admin/doctors/${doctorId}/schedules`, { method: s ? 'PATCH' : 'POST', body }));
    if (r) {
      const { kept, cancelled } = r.result;
      if (kept > 0) toast(`Saved. ${kept} upcoming sitting${kept > 1 ? 's' : ''} kept as before because patients already booked.`);
      else if (cancelled > 0) toast(`Saved. ${cancelled} upcoming sitting${cancelled > 1 ? 's' : ''} removed (nobody had booked).`);
      else toast('Saved');
      onSaved();
    }
  }

  return (
    <Drawer title={s ? 'Change sitting time' : 'Add sitting time'} onClose={onClose}>
      <div className="card" style={{ display: 'grid', gap: 14 }}>
        <Field label="Chamber">
          <select className="input" value={chamberId} onChange={(e) => setChamberId(e.target.value)} disabled={!!s}>
            {chambers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <div className="f">Days
          <div className="days">{[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <button key={d} type="button" className={`day ${days.includes(d) ? 'on' : ''}`} aria-pressed={days.includes(d)} onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}>{dayName(d)}</button>
          ))}</div>
        </div>
        <div className="form">
          <Field label="Starts at"><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Field label="Serials per sitting"><input className="input" type="number" min={1} max={500} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></Field>
          <Field label="Share for online booking (%)"><input className="input" type="number" min={0} max={100} value={share} onChange={(e) => setShare(Number(e.target.value))} /></Field>
          <div className="f">Split<div className="muted" style={{ fontWeight: 500, paddingTop: 10 }}>{Math.floor((limit * share) / 100)} online, {limit - Math.floor((limit * share) / 100)} at the counter</div></div>
        </div>
        {s ? <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Still sitting at this time</label> : null}
        <p className="muted small" style={{ margin: 0 }}>Changes apply from tomorrow. Days that already have bookings keep their time, and their limits never go below what is booked.</p>
        <button className="btn primary" onClick={save} disabled={busy || !chamberId || days.length === 0 || !time}>{s ? 'Save' : 'Add'}</button>
      </div>
    </Drawer>
  );
}
