import { useState } from 'react';
import { api, dateTime, Drawer, Field, Loading, PasswordInput, Pill, useAction, useAuth, useLoad, type Role } from '../lib';

type Member = { id: string; username: string; name: string; role: Role; active: boolean; lastLoginAt: string | null };
const ROLE_TEXT: Record<Role, string> = { OWNER: 'Owner: everything, including paying chambers and the team', MANAGER: 'Manager: doctors, chambers, sittings and refunds', SUPPORT: 'Support: can look things up, cannot change them' };

export default function Team() {
  const { admin } = useAuth();
  const { data, error, loading, reload } = useLoad<Member[]>('/admin/team');
  const [open, setOpen] = useState<Member | 'new' | null>(null);
  return (
    <>
      <div className="head">
        <div><h1>Team</h1><div className="sub">Who can sign in to this admin panel.</div></div>
        <button className="btn primary" onClick={() => setOpen('new')}>Add person</button>
      </div>
      <div className="card flush">
        <Loading error={error} loading={loading && !data} />
        {data ? (
          <table>
            <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Last sign in</th><th /></tr></thead>
            <tbody>{data.map((m) => (
              <tr key={m.id} className="click" onClick={() => setOpen(m)} style={{ opacity: m.active ? 1 : 0.5 }}>
                <td className="strong">{m.name}{m.id === admin?.id ? <span className="muted small"> (you)</span> : null}</td>
                <td>{m.username}</td>
                <td><Pill tone={m.role === 'OWNER' ? 'teal' : 'plain'}>{m.role.toLowerCase()}</Pill></td>
                <td className="muted">{m.lastLoginAt ? dateTime(m.lastLoginAt) : 'Never'}</td>
                <td>{m.active ? null : <Pill tone="plain">Turned off</Pill>}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : null}
      </div>
      {open ? <MemberDrawer m={open === 'new' ? null : open} self={open !== 'new' && open.id === admin?.id} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); void reload(); }} /> : null}
    </>
  );
}

function MemberDrawer({ m, self, onClose, onSaved }: { m: Member | null; self: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(m?.name ?? '');
  const [username, setUsername] = useState(m?.username ?? '');
  const [role, setRole] = useState<Role>(m?.role ?? 'SUPPORT');
  const [password, setPassword] = useState('');
  const { run, busy } = useAction();
  async function save() {
    const ok = m
      ? await run(() => api(`/admin/team/${m.id}`, { method: 'PATCH', body: { name, role, ...(password ? { password } : {}) } }), 'Saved')
      : await run(() => api('/admin/team', { body: { name, username, role, password } }), 'Added');
    if (ok) onSaved();
  }
  return (
    <Drawer title={m ? m.name : 'Add person'} onClose={onClose}>
      <div className="card" style={{ display: 'grid', gap: 14 }}>
        <Field label="Full name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {!m ? <Field label="Username"><input className="input" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoComplete="off" /></Field> : null}
        <div className="f">Role
          {(['OWNER', 'MANAGER', 'SUPPORT'] as Role[]).map((r) => (
            <label key={r} className="check" style={{ fontWeight: 500, color: 'var(--ink)' }}>
              <input type="radio" name="role" checked={role === r} disabled={self} onChange={() => setRole(r)} /> {ROLE_TEXT[r]}
            </label>
          ))}
        </div>
        <PasswordInput label={m ? 'New password (leave empty to keep)' : 'Password'} value={password} onChange={setPassword} />
        <p className="muted small" style={{ margin: 0 }}>At least 8 characters. Changing it signs them out everywhere.</p>
        <button className="btn primary" disabled={busy || name.trim().length < 2 || (!m && (username.length < 3 || password.length < 8)) || (!!password && password.length < 8)} onClick={save}>{m ? 'Save' : 'Add'}</button>
        {m && !self ? (
          <button className="btn danger" disabled={busy} onClick={async () => { if (await run(() => api(`/admin/team/${m.id}`, { method: 'PATCH', body: { active: !m.active } }), m.active ? 'Turned off' : 'Turned on')) onSaved(); }}>
            {m.active ? 'Turn off this person' : 'Turn this person back on'}
          </button>
        ) : null}
      </div>
    </Drawer>
  );
}
