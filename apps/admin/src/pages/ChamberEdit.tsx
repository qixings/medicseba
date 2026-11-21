import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, Drawer, Field, Loading, PasswordInput, Pill, rupee, useAction, useAuth, useLoad, useToast } from '../lib';
import { SittingList, type Draft, type Sitting } from '../components/Sittings';

type Agent = { id: string; username: string; active: boolean };
type Chamber = {
  id: string; name: string; kind: 'PHARMACY' | 'OWN'; address: string; area: string; landmark: string; lat: number | null; lng: number | null;
  phone: string; openingHours: string; bookingFee: number; platformFee: number; visible: boolean; photos: string[]; agents: Agent[];
  schedules: Sitting[];
};

const blank = { name: '', kind: 'PHARMACY' as 'PHARMACY' | 'OWN', address: '', area: '', landmark: '', lat: '', lng: '', phone: '', openingHours: '09:00-21:00', bookingFee: 55, platformFee: 10, visible: true };

export default function ChamberEdit() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const { can } = useAuth();
  const edit = can('MANAGER');
  const c = useLoad<Chamber>(isNew ? null : `/admin/chambers/${id}`, { live: false });
  const [f, setF] = useState(blank);
  const { run, busy } = useAction();
  const [login, setLogin] = useState<Agent | 'new' | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const toast = useToast();

  useEffect(() => {
    const x = c.data;
    if (x) setF({ name: x.name, kind: x.kind, address: x.address, area: x.area, landmark: x.landmark, lat: x.lat?.toString() ?? '', lng: x.lng?.toString() ?? '', phone: x.phone, openingHours: x.openingHours, bookingFee: x.bookingFee, platformFee: x.platformFee, visible: x.visible });
  }, [c.data]);
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setF((x) => ({ ...x, [k]: v }));

  /** Accepts "24.33, 92.01" pasted from Google Maps into the latitude box. */
  function pasteLatLng(v: string) {
    const m = v.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    if (m) setF((x) => ({ ...x, lat: m[1], lng: m[2] })); else set('lat', v);
  }

  async function save() {
    const body = { ...f, lat: f.lat ? Number(f.lat) : null, lng: f.lng ? Number(f.lng) : null };
    if (isNew) {
      const sittings = drafts.map(({ doctorId, newDoctor, weekdays, startTime, tokenLimit, onlineShare }) => ({ doctorId, newDoctor, weekdays, startTime, tokenLimit, onlineShare }));
      const r = await run(() => api<{ id: string }>('/admin/chambers', { body: { ...body, sittings } }), 'Chamber added. Now give it a counter login.');
      if (r) { setDrafts([]); nav(`/chambers/${r.id}`, { replace: true }); }
    } else if (await run(() => api(`/admin/chambers/${id}`, { method: 'PATCH', body }), 'Saved')) void c.reload();
  }

  /** Hides the chamber everywhere, stops every sitting there (booked patients can move free) and turns off its counter logins. */
  async function removeChamber() {
    const n = c.data?.schedules.length ?? 0;
    if (!window.confirm(`Remove ${c.data?.name}?\n\nIt disappears from the patient app and its counter logins stop working.${n ? ` The ${n} sitting${n > 1 ? 's' : ''} here stop: upcoming days are cancelled, and patients who booked are told and can move their serial for free.` : ''} The doctors stay in the Doctors list. Past bookings and settlements are kept.`)) return;
    const r = await run(() => api<{ patients: number }>(`/admin/chambers/${id}`, { method: 'DELETE' }));
    if (r) { toast(r.patients ? `Chamber removed. ${r.patients} booked patient${r.patients > 1 ? 's were' : ' was'} told.` : 'Chamber removed'); nav('/chambers', { replace: true }); }
  }

  if (!isNew && !c.data) return <Loading error={c.error} loading />;
  const x = c.data;
  const ok = f.name.trim().length >= 2 && f.address.trim().length >= 3 && f.area.trim().length >= 2;

  return (
    <>
      <div className="head">
        <div><div className="small"><Link to="/chambers">Chambers</Link></div><h1>{isNew ? 'New chamber' : x!.name}</h1></div>
        <div className="row">
          {!isNew && can('OWNER') ? <button className="btn danger" disabled={busy} onClick={removeChamber}>Remove chamber</button> : null}
          {edit ? <button className="btn primary" onClick={save} disabled={busy || !ok}>{isNew ? 'Add chamber' : 'Save changes'}</button> : null}
        </div>
      </div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h2>Details</h2>
          <fieldset disabled={!edit} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="form">
              <Field label="Name" full><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
              <Field label="Type">
                <select className="input" value={f.kind} onChange={(e) => set('kind', e.target.value as 'PHARMACY' | 'OWN')}>
                  <option value="PHARMACY">Pharmacy</option><option value="OWN">Doctor's own chamber</option>
                </select>
              </Field>
              <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91" /></Field>
              <Field label="Address" full><input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
              <Field label="Area"><input className="input" value={f.area} onChange={(e) => set('area', e.target.value)} placeholder="Station Road" /></Field>
              <Field label="Landmark"><input className="input" value={f.landmark} onChange={(e) => set('landmark', e.target.value)} placeholder="Opposite SBI" /></Field>
              <Field label="Latitude (or paste both from Google Maps)"><input className="input" value={f.lat} onChange={(e) => pasteLatLng(e.target.value)} /></Field>
              <Field label="Longitude"><input className="input" value={f.lng} onChange={(e) => set('lng', e.target.value)} /></Field>
              <Field label="Open hours (24-hour)"><input className="input" value={f.openingHours} onChange={(e) => set('openingHours', e.target.value)} placeholder="09:00-21:00" /></Field>
              <div />
              <Field label="Booking fee, goes to the chamber (₹)"><input className="input" type="number" min={0} value={f.bookingFee} onChange={(e) => set('bookingFee', Number(e.target.value))} /></Field>
              <Field label="Service fee, goes to MedicSeba (₹)"><input className="input" type="number" min={0} value={f.platformFee} onChange={(e) => set('platformFee', Number(e.target.value))} /></Field>
              <div className="full muted">Patients pay <b className="num">{rupee(f.bookingFee + f.platformFee)}</b> per online serial.</div>
              <label className="check full"><input type="checkbox" checked={f.visible} onChange={(e) => set('visible', e.target.checked)} /> Show this chamber in the patient app</label>
            </div>
          </fieldset>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <SittingList side="chamber" ownerId={isNew ? null : id!} saved={x?.schedules ?? []} drafts={drafts} edit={edit} onChange={() => void c.reload()} onDrafts={setDrafts} />
        {!isNew ? (
          <>
            <Photos chamberId={id!} photos={x!.photos} edit={edit} onChange={() => void c.reload()} />
            <div className="card flush">
              <div className="row" style={{ padding: '16px 18px 4px', justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0 }}>Counter logins</h2>
                {edit ? <button className="btn sm primary" onClick={() => setLogin('new')}>Add login</button> : null}
              </div>
              <p className="muted small" style={{ padding: '0 18px' }}>Staff sign in to the counter app at <b>/agent</b> with one shared login per chamber.</p>
              <Loading empty={x!.agents.length === 0 && 'No login yet. The counter cannot run the queue without one.'} />
              {x!.agents.length ? (
                <table>
                  <tbody>{x!.agents.map((a) => (
                    <tr key={a.id}>
                      <td className="strong">{a.username}</td>
                      <td>{a.active ? <Pill tone="good">Active</Pill> : <Pill tone="plain">Turned off</Pill>}</td>
                      <td className="right">{edit ? <button className="btn sm" onClick={() => setLogin(a)}>Change</button> : null}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : null}
            </div>
          </>
        ) : null}
        </div>
      </div>
      {login ? <LoginDrawer chamberId={id!} a={login === 'new' ? null : login} onClose={() => setLogin(null)} onSaved={() => { setLogin(null); void c.reload(); }} /> : null}
    </>
  );
}

function LoginDrawer({ chamberId, a, onClose, onSaved }: { chamberId: string; a: Agent | null; onClose: () => void; onSaved: () => void }) {
  const [username, setUsername] = useState(a?.username ?? '');
  const [password, setPassword] = useState('');
  const { run, busy } = useAction();
  return (
    <Drawer title={a ? `Login ${a.username}` : 'New counter login'} onClose={onClose}>
      <div className="card" style={{ display: 'grid', gap: 14 }}>
        {!a ? <Field label="Login name"><input className="input" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="citymedicos" autoComplete="off" /></Field> : null}
        <PasswordInput label={a ? 'New password' : 'Password'} value={password} onChange={setPassword} />
        <p className="muted small" style={{ margin: 0 }}>At least 8 characters. Give it to the chamber staff in person.</p>
        <button className="btn primary" disabled={busy || password.length < 8 || (!a && username.length < 3)} onClick={async () => {
          const ok = await run(() => a ? api(`/admin/agents/${a.id}`, { method: 'PATCH', body: { password } }) : api(`/admin/chambers/${chamberId}/agents`, { body: { username, password } }), a ? 'Password changed' : 'Login added');
          if (ok) onSaved();
        }}>{a ? 'Change password' : 'Add login'}</button>
        {a ? (
          <button className="btn danger" disabled={busy} onClick={async () => {
            if (await run(() => api(`/admin/agents/${a.id}`, { method: 'PATCH', body: { active: !a.active } }), a.active ? 'Login turned off' : 'Login turned on')) onSaved();
          }}>{a.active ? 'Turn off this login' : 'Turn this login back on'}</button>
        ) : null}
      </div>
    </Drawer>
  );
}

/** Chamber photos: add, replace, reorder and delete. The first one is the cover in the patient app. */
function Photos({ chamberId, photos, edit, onChange }: { chamberId: string; photos: string[]; edit: boolean; onChange: () => void }) {
  const { run, busy } = useAction();
  const addRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<string | null>(null);

  async function upload(file: File, replace?: string | null) {
    const form = new FormData(); form.append('photo', file);
    const q = replace ? `?replace=${encodeURIComponent(replace)}` : '';
    if (await run(() => api(`/admin/chambers/${chamberId}/photos${q}`, { form }), replace ? 'Photo replaced' : 'Photo added')) onChange();
  }
  async function save(list: string[], msg: string) {
    if (await run(() => api(`/admin/chambers/${chamberId}/photos`, { method: 'PUT', body: { photos: list } }), msg)) onChange();
  }
  const move = (i: number, by: number) => { const l = [...photos]; const [p] = l.splice(i, 1); l.splice(i + by, 0, p); void save(l, 'Order saved'); };

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Photos</h2>
        {edit && photos.length < 8 ? <button className="btn sm primary" disabled={busy} onClick={() => addRef.current?.click()}>Add photo</button> : null}
      </div>
      <input ref={addRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
      <input ref={replaceRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, replacing); e.target.value = ''; setReplacing(null); }} />
      {photos.length === 0 ? <p className="muted" style={{ margin: 0 }}>No photos yet. A clear photo of the front of the chamber helps patients find it. The first photo is the cover.</p> : (
        <div className="thumbs">
          {photos.map((p, i) => (
            <figure key={p} className="thumb">
              <img src={p} alt={`Photo ${i + 1}`} />
              {i === 0 ? <span className="pill teal cover">Cover</span> : null}
              {edit ? (
                <figcaption>
                  <button className="btn sm" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label="Move left">←</button>
                  <button className="btn sm" disabled={busy || i === photos.length - 1} onClick={() => move(i, 1)} aria-label="Move right">→</button>
                  <button className="btn sm" disabled={busy} onClick={() => { setReplacing(p); replaceRef.current?.click(); }}>Replace</button>
                  <button className="btn sm danger" disabled={busy} onClick={() => { if (window.confirm('Delete this photo?')) void save(photos.filter((x) => x !== p), 'Photo deleted'); }}>Delete</button>
                </figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
