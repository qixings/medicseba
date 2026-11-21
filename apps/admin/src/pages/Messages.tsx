import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, dateTime, Field, istToday, Loading, Pill, prettyDate, useAction, useAuth, useLoad, useToast } from '../lib';

type Kind = 'all_patients' | 'chamber_patients' | 'doctor_patients' | 'sitting_patients' | 'patient' | 'all_counters' | 'counter';
type Broadcast = { id: string; audience: { kind: Kind; label: string }; title: string; body: string; channels: string[]; recipients: number; sent: number; status: string; createdAt: string; admin: string };
type Opt = { id: string; name: string };
type Sitting = { id: string; time: string; doctor: { name: string }; chamber: { name: string } };

const KINDS: { v: Kind; label: string; group: 'Patients' | 'Chamber counters' }[] = [
  { v: 'all_patients', label: 'Everyone who signed up', group: 'Patients' },
  { v: 'chamber_patients', label: 'Patients with an upcoming serial at a chamber', group: 'Patients' },
  { v: 'doctor_patients', label: 'Patients with an upcoming serial with a doctor', group: 'Patients' },
  { v: 'sitting_patients', label: 'Patients of one sitting', group: 'Patients' },
  { v: 'patient', label: 'One patient', group: 'Patients' },
  { v: 'all_counters', label: 'All chamber counters', group: 'Chamber counters' },
  { v: 'counter', label: 'One chamber counter', group: 'Chamber counters' },
];

export default function Messages() {
  const { can } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const [kind, setKind] = useState<Kind>(params.get('patient') ? 'patient' : 'chamber_patients');
  const [target, setTarget] = useState(params.get('patient') ?? '');
  const [date, setDate] = useState(istToday());
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [whatsapp, setWhatsapp] = useState(false);
  const [count, setCount] = useState<{ patients: number; counters: number } | null>(null);
  const chambers = useLoad<Opt[]>('/admin/chambers');
  const doctors = useLoad<Opt[]>('/admin/doctors');
  const sittings = useLoad<Sitting[]>(kind === 'sitting_patients' ? `/admin/sessions?date=${date}` : null);
  const history = useLoad<Broadcast[]>('/admin/broadcasts');
  const settings = useLoad<{ settings: { whatsapp: { enabled: boolean } }; status: { whatsapp: boolean } }>(can('OWNER') ? '/admin/settings/notifications' : null);
  const { run, busy } = useAction();
  const needsTarget = !['all_patients', 'all_counters'].includes(kind);
  const toCounters = kind === 'all_counters' || kind === 'counter';
  const audience = useMemo(() => (needsTarget ? { kind, id: target } : { kind }), [kind, target, needsTarget]);

  useEffect(() => {
    setCount(null);
    if (needsTarget && !target) return;
    const id = setTimeout(() => { api<{ patients: number; counters: number }>('/admin/broadcasts/preview', { body: audience }).then(setCount).catch(() => {}); }, 250);
    return () => clearTimeout(id);
  }, [audience, needsTarget, target]);

  // Refresh history while a message is still going out.
  useEffect(() => {
    if (!history.data?.some((b) => b.status === 'SENDING')) return;
    const id = setInterval(() => void history.reload(), 3000);
    return () => clearInterval(id);
  }, [history.data, history]);

  const label = (() => {
    const k = KINDS.find((x) => x.v === kind)!.label;
    if (kind === 'chamber_patients' || kind === 'counter') return `${k}: ${chambers.data?.find((c) => c.id === target)?.name ?? ''}`;
    if (kind === 'doctor_patients') return `${k}: ${doctors.data?.find((d) => d.id === target)?.name ?? ''}`;
    if (kind === 'sitting_patients') { const s = sittings.data?.find((x) => x.id === target); return s ? `Patients of ${s.doctor.name}, ${prettyDate(date)} ${s.time}` : k; }
    if (kind === 'patient') return `Patient: ${params.get('name') ?? target}`;
    return k;
  })();
  const reach = count ? (toCounters ? count.counters : count.patients) : null;

  async function send() {
    if (!window.confirm(`Send "${title}" to ${reach} ${toCounters ? 'counter' : 'patient'}${reach === 1 ? '' : 's'}?`)) return;
    const r = await run(() => api('/admin/broadcasts', { body: { audience, label, title, body, whatsapp: whatsapp && !toCounters } }));
    if (r) { toast('Sending'); setTitle(''); setBody(''); void history.reload(); }
  }

  const waReady = settings.data ? settings.data.status.whatsapp && settings.data.settings.whatsapp.enabled : false;

  return (
    <>
      <div className="head"><div><h1>Messages</h1><div className="sub">Tell patients or chamber counters something: a closed day, a changed time, a new doctor.</div></div></div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        {can('MANAGER') ? (
          <div className="card" style={{ display: 'grid', gap: 14 }}>
            <h2 style={{ margin: 0 }}>New message</h2>
            <Field label="Send to">
              <select className="input" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setTarget(''); }}>
                {(['Patients', 'Chamber counters'] as const).map((g) => (
                  <optgroup key={g} label={g}>{KINDS.filter((k) => k.group === g && (k.v !== 'patient' || params.get('patient'))).map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}</optgroup>
                ))}
              </select>
            </Field>
            {kind === 'chamber_patients' || kind === 'counter' ? (
              <Field label="Chamber"><select className="input" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Pick a chamber</option>{chambers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            ) : null}
            {kind === 'doctor_patients' ? (
              <Field label="Doctor"><select className="input" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Pick a doctor</option>{doctors.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
            ) : null}
            {kind === 'sitting_patients' ? (
              <div className="form">
                <Field label="Day"><input className="input" type="date" value={date} onChange={(e) => { setDate(e.target.value); setTarget(''); }} /></Field>
                <Field label="Sitting"><select className="input" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Pick a sitting</option>{sittings.data?.map((s) => <option key={s.id} value={s.id}>{s.time}, {s.doctor.name}, {s.chamber.name}</option>)}</select></Field>
              </div>
            ) : null}
            <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="City Medicos closed on Sunday" /></Field>
            <Field label={`Message (${body.length}/600)`}><textarea className="input" value={body} onChange={(e) => setBody(e.target.value)} maxLength={600} rows={4} placeholder="Write it the way you would say it. Bengali is fine." /></Field>
            {!toCounters ? (
              <label className="check" style={{ opacity: waReady ? 1 : 0.6 }}>
                <input type="checkbox" checked={whatsapp && waReady} disabled={!waReady} onChange={(e) => setWhatsapp(e.target.checked)} />
                Also send on WhatsApp {waReady ? null : <span className="muted small">(turn WhatsApp on in Settings first)</span>}
              </label>
            ) : null}
            <div className="muted small">{toCounters ? 'Shows in the counter app at the top of the sittings screen.' : 'Goes to the app notifications and as a phone alert to everyone who turned alerts on.'}</div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="strong">{reach === null ? '' : `Reaches ${reach} ${toCounters ? 'counter' : 'patient'}${reach === 1 ? '' : 's'}`}</span>
              <button className="btn primary" disabled={busy || !reach || title.trim().length < 2 || body.trim().length < 2} onClick={send}>Send</button>
            </div>
          </div>
        ) : null}
        <div className="card flush">
          <div style={{ padding: '16px 18px 4px' }}><h2>Sent</h2></div>
          <Loading error={history.error} loading={history.loading && !history.data} empty={history.data?.length === 0 && 'No messages sent yet.'} />
          {history.data?.length ? (
            <table><tbody>{history.data.map((b) => (
              <tr key={b.id}>
                <td>
                  <div className="strong">{b.title}</div>
                  <div className="muted small" style={{ whiteSpace: 'pre-wrap' }}>{b.body}</div>
                  <div className="small" style={{ marginTop: 4 }}>{b.audience.label}</div>
                </td>
                <td className="right small" style={{ whiteSpace: 'nowrap' }}>
                  <div>{b.status === 'SENDING' ? <Pill tone="warn">Sending {b.sent}/{b.recipients}</Pill> : b.status === 'FAILED' ? <Pill tone="bad">Failed</Pill> : <Pill tone="good">{b.recipients} reached</Pill>}</div>
                  <div className="muted" style={{ marginTop: 4 }}>{b.channels.includes('whatsapp') ? 'App, WhatsApp' : b.channels.includes('counter') ? 'Counter app' : 'App'}</div>
                  <div className="muted">{dateTime(b.createdAt)}, {b.admin}</div>
                </td>
              </tr>
            ))}</tbody></table>
          ) : null}
        </div>
      </div>
    </>
  );
}
