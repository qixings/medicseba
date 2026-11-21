import { useEffect, useState } from 'react';
import { api, dateTime, Field, Loading, Pill, useAction, useLoad } from '../lib';

type Data = {
  settings: { whatsapp: { enabled: boolean; template: string; events: Record<string, boolean> } };
  events: { kind: string; label: string }[];
  status: { whatsapp: boolean; sms: string; payments: string; pushDevices: number };
  log: { id: string; channel: string; to: string; kind: string; status: string; error: string | null; createdAt: string }[];
};

export default function Settings() {
  const { data, error, reload } = useLoad<Data>('/admin/settings/notifications');
  const [wa, setWa] = useState<Data['settings']['whatsapp'] | null>(null);
  const [testTo, setTestTo] = useState('');
  const { run, busy } = useAction();
  useEffect(() => { if (data) setWa(data.settings.whatsapp); }, [data]);
  if (!data || !wa) return <Loading error={error} loading />;
  const s = data.status;

  return (
    <>
      <div className="head"><div><h1>Settings</h1><div className="sub">How MedicSeba reaches patients. Keys and passwords stay on the server, in its .env file.</div></div></div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card">
            <h2>Channels</h2>
            <table><tbody>
              <tr><td className="strong">In-app notifications</td><td className="right"><Pill tone="good">Always on</Pill></td></tr>
              <tr><td><div className="strong">Phone alerts (push)</div><div className="muted small">{s.pushDevices} patient phone{s.pushDevices === 1 ? '' : 's'} with alerts on. Works in the Android and iPhone apps.</div></td><td className="right"><Pill tone={s.pushDevices ? 'good' : 'plain'}>{s.pushDevices ? 'Working' : 'No phones yet'}</Pill></td></tr>
              <tr><td><div className="strong">Login codes by SMS</div><div className="muted small">{s.sms === 'msg91' ? 'Sent through MSG91.' : 'Test mode: the code shows on screen.'}</div></td><td className="right"><Pill tone={s.sms === 'msg91' ? 'good' : 'warn'}>{s.sms === 'msg91' ? 'MSG91' : 'Test mode'}</Pill></td></tr>
              <tr><td><div className="strong">Payments</div><div className="muted small">{s.payments === 'razorpay' ? 'Razorpay is taking real payments.' : 'Test payments, no money moves.'}</div></td><td className="right"><Pill tone={s.payments === 'razorpay' ? 'good' : 'warn'}>{s.payments === 'razorpay' ? 'Razorpay' : 'Test mode'}</Pill></td></tr>
              <tr><td><div className="strong">WhatsApp</div><div className="muted small">{s.whatsapp ? 'Connected to WhatsApp Business.' : 'Not connected yet. See the steps below.'}</div></td><td className="right"><Pill tone={s.whatsapp ? (wa.enabled ? 'good' : 'plain') : 'warn'}>{s.whatsapp ? (wa.enabled ? 'On' : 'Off') : 'Not connected'}</Pill></td></tr>
            </tbody></table>
          </div>

          <div className="card" style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0 }}>WhatsApp messages</h2>
            <label className="check"><input type="checkbox" checked={wa.enabled} onChange={(e) => setWa({ ...wa, enabled: e.target.checked })} /> Send WhatsApp messages to patients</label>
            <Field label="Approved template name"><input className="input" value={wa.template} onChange={(e) => setWa({ ...wa, template: e.target.value.trim() })} /></Field>
            <div className="f">Send on WhatsApp when
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
                {data.events.map((e) => (
                  <label key={e.kind} className="check" style={{ fontWeight: 500, color: 'var(--ink)' }}>
                    <input type="checkbox" checked={!!wa.events[e.kind]} onChange={(x) => setWa({ ...wa, events: { ...wa.events, [e.kind]: x.target.checked } })} /> {e.label}
                  </label>
                ))}
              </div>
            </div>
            <p className="muted small" style={{ margin: 0 }}>Each WhatsApp message costs money (Meta charges per message). Phone alerts and in-app notifications are free, so keep WhatsApp for the messages that matter most.</p>
            <button className="btn primary" disabled={busy} onClick={async () => { if (await run(() => api('/admin/settings/notifications', { method: 'PUT', body: { whatsapp: wa } }), 'Saved')) void reload(); }}>Save</button>
            <div className="row">
              <input className="input" style={{ flex: 1 }} placeholder="Your WhatsApp number" value={testTo} onChange={(e) => setTestTo(e.target.value)} aria-label="Test number" />
              <button className="btn" disabled={busy || !s.whatsapp || testTo.replace(/\D/g, '').length < 10} onClick={async () => { await run(() => api('/admin/settings/notifications/test', { body: { phone: testTo } }), 'Test message sent'); void reload(); }}>Send test</button>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card">
            <h2>Connect WhatsApp</h2>
            <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8, lineHeight: 1.5 }}>
              <li>Open <b>business.facebook.com</b>, create a Business account, and in <b>WhatsApp Manager</b> add a phone number that is not used on the WhatsApp app.</li>
              <li>In <b>Message templates</b>, create a <b>Utility</b> template named <code>{wa.template}</code> in English, and again in Bengali, with this body:<br /><code>{'{{1}}'}</code><br /><code>{'{{2}}'}</code><br />MedicSeba fills in the title and the message.</li>
              <li>In <b>developers.facebook.com</b>, create an app with WhatsApp, make a <b>System user</b> with a permanent token, and copy the <b>Phone number ID</b>.</li>
              <li>On the server, add these two lines to <code>/opt/medicseba/apps/api/.env</code>, then run <code>pm2 restart medicseba-api</code>:<br /><code>WHATSAPP_TOKEN=...</code><br /><code>WHATSAPP_PHONE_NUMBER_ID=...</code></li>
              <li>Come back here, turn WhatsApp on, and send yourself a test.</li>
            </ol>
          </div>
          <div className="card flush">
            <div style={{ padding: '16px 18px 4px' }}><h2>Recent WhatsApp sends</h2></div>
            <Loading empty={data.log.length === 0 && 'Nothing sent in the last 30 days.'} />
            {data.log.length ? <table><tbody>{data.log.map((l) => (
              <tr key={l.id}><td className="num">{l.to}</td><td className="muted">{l.kind}</td><td>{l.status === 'sent' ? <Pill tone="good">Sent</Pill> : <Pill tone="bad">Failed</Pill>}{l.error ? <div className="small err">{l.error}</div> : null}</td><td className="muted small right">{dateTime(l.createdAt)}</td></tr>
            ))}</tbody></table> : null}
          </div>
        </div>
      </div>
    </>
  );
}
