import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, Field, Loading, useAction, useAuth, useLoad, useToast } from '../lib';
import { SittingList, type Draft, type Sitting } from '../components/Sittings';

type Doctor = {
  id: string; name: string; photoUrl: string | null; degrees: string; specialtyId: string; experienceYears: number; consultFee: number;
  languages: string[]; bio: string; bookingWindowDays: number; visible: boolean; schedules: Sitting[];
};
type Spec = { id: string; name: string };

const blank = { name: 'Dr. ', degrees: '', specialtyId: '', experienceYears: 0, consultFee: 0, languages: ['Bengali'], bio: '', bookingWindowDays: 7, visible: true };

export default function DoctorEdit() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const { can } = useAuth();
  const edit = can('MANAGER');
  const toast = useToast();
  const doc = useLoad<Doctor>(isNew ? null : `/admin/doctors/${id}`, { live: false });
  const specs = useLoad<Spec[]>('/admin/specialties');
  const [f, setF] = useState(blank);
  const [langs, setLangs] = useState('Bengali');
  const { run, busy } = useAction();
  const [drafts, setDrafts] = useState<Draft[]>([]);
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
      const sittings = drafts.map(({ chamberId, weekdays, startTime, tokenLimit, onlineShare }) => ({ chamberId, weekdays, startTime, tokenLimit, onlineShare }));
      const r = await run(() => api<{ id: string }>('/admin/doctors', { body: { ...body, sittings } }), sittings.length ? 'Doctor added with their sittings' : 'Doctor added. Now add where they sit.');
      if (r) { setDrafts([]); nav(`/doctors/${r.id}`, { replace: true }); }
    } else if (await run(() => api(`/admin/doctors/${id}`, { method: 'PATCH', body }), 'Saved')) void doc.reload();
  }

  /** Hides the doctor everywhere; every sitting stops and booked patients can move for free. Past bookings stay. */
  async function removeDoctor() {
    const n = doc.data?.schedules.length ?? 0;
    if (!window.confirm(`Remove ${doc.data?.name}?\n\nThey disappear from the patient app and the Doctors list.${n ? ` Their ${n} sitting${n > 1 ? 's' : ''} stop: upcoming days are cancelled, and patients who booked are told and can move their serial for free.` : ''} Past bookings and receipts are kept.`)) return;
    const r = await run(() => api<{ patients: number }>(`/admin/doctors/${id}`, { method: 'DELETE' }));
    if (r) { toast(r.patients ? `Doctor removed. ${r.patients} booked patient${r.patients > 1 ? 's were' : ' was'} told.` : 'Doctor removed'); nav('/doctors', { replace: true }); }
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
        <div className="row">
          {!isNew && can('OWNER') ? <button className="btn danger" disabled={busy} onClick={removeDoctor}>Remove doctor</button> : null}
          {edit ? <button className="btn primary" onClick={save} disabled={busy || f.name.trim().length < 4 || !f.degrees.trim() || !f.specialtyId}>{isNew ? 'Add doctor' : 'Save changes'}</button> : null}
        </div>
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

          <SittingList side="doctor" ownerId={isNew ? null : id!} saved={d?.schedules ?? []} drafts={drafts} edit={edit} onChange={() => void doc.reload()} onDrafts={setDrafts} />
        </div>
      </div>
    </>
  );
}
