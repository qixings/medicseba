import { useState } from 'react';
import { api, Loading, useAction, useAuth, useLoad } from '../lib';

type Spec = { id: string; slug: string; name: string; icon: string; order: number };
const ICONS = ['steth', 'baby', 'heart', 'drop', 'ear', 'eye', 'bone', 'tooth'];

export default function Specialties() {
  const { can } = useAuth();
  const edit = can('MANAGER');
  const { data, error, loading, reload } = useLoad<Spec[]>('/admin/specialties');
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('steth');
  const { run, busy } = useAction();
  return (
    <>
      <div className="head"><div><h1>Specialties</h1><div className="sub">The groups patients browse by on the home screen. Lower order shows first.</div></div></div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="card flush">
          <Loading error={error} loading={loading && !data} />
          {data ? (
            <table>
              <thead><tr><th>Name</th><th>Icon</th><th>Order</th><th /></tr></thead>
              <tbody>{data.map((s) => <SpecRow key={s.id} s={s} edit={edit} onSaved={reload} />)}</tbody>
            </table>
          ) : null}
        </div>
        {edit ? (
          <div className="card" style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0 }}>Add a specialty</h2>
            <label className="f">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Heart" /></label>
            <label className="f">Icon<select className="input" value={icon} onChange={(e) => setIcon(e.target.value)}>{ICONS.map((i) => <option key={i}>{i}</option>)}</select></label>
            <button className="btn primary" disabled={busy || name.trim().length < 2} onClick={async () => { if (await run(() => api('/admin/specialties', { body: { name, icon, order: (data?.length ?? 0) + 1 } }), 'Added')) { setName(''); void reload(); } }}>Add</button>
          </div>
        ) : null}
      </div>
    </>
  );
}

function SpecRow({ s, edit, onSaved }: { s: Spec; edit: boolean; onSaved: () => void }) {
  const [name, setName] = useState(s.name);
  const [icon, setIcon] = useState(s.icon);
  const [order, setOrder] = useState(s.order);
  const { run, busy } = useAction();
  const changed = name !== s.name || icon !== s.icon || order !== s.order;
  return (
    <tr>
      <td><input className="input" value={name} disabled={!edit} onChange={(e) => setName(e.target.value)} aria-label="Name" /></td>
      <td><select className="input" value={icon} disabled={!edit} onChange={(e) => setIcon(e.target.value)} aria-label="Icon">{ICONS.map((i) => <option key={i}>{i}</option>)}</select></td>
      <td><input className="input num" style={{ width: 70 }} type="number" value={order} disabled={!edit} onChange={(e) => setOrder(Number(e.target.value))} aria-label="Order" /></td>
      <td className="right">{edit && changed ? <button className="btn sm primary" disabled={busy} onClick={async () => { if (await run(() => api(`/admin/specialties/${s.id}`, { method: 'PATCH', body: { name, icon, order } }), 'Saved')) onSaved(); }}>Save</button> : null}</td>
    </tr>
  );
}
