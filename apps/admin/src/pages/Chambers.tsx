import { useNavigate } from 'react-router-dom';
import { Loading, Pill, rupee, useAuth, useLoad } from '../lib';

type Row = { id: string; name: string; kind: 'PHARMACY' | 'OWN'; area: string; phone: string; bookingFee: number; platformFee: number; visible: boolean; doctors: number; logins: number };

export default function Chambers() {
  const { can } = useAuth();
  const nav = useNavigate();
  const { data, error, loading } = useLoad<Row[]>('/admin/chambers');
  return (
    <>
      <div className="head">
        <div><h1>Chambers</h1><div className="sub">Pharmacies and doctors' own chambers, their fees and counter logins.</div></div>
        {can('MANAGER') ? <button className="btn primary" onClick={() => nav('/chambers/new')}>Add chamber</button> : null}
      </div>
      <div className="card flush">
        <Loading error={error} loading={loading && !data} empty={data?.length === 0 && 'No chambers yet.'} />
        {data?.length ? (
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Area</th><th className="right">Doctors</th><th className="right">Patient pays</th><th className="right">Chamber gets</th><th className="right">Counter logins</th><th>Shown</th></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="click" onClick={() => nav(`/chambers/${c.id}`)}>
                  <td className="strong">{c.name}</td>
                  <td>{c.kind === 'PHARMACY' ? 'Pharmacy' : 'Own chamber'}</td>
                  <td className="muted">{c.area}</td>
                  <td className="right num">{c.doctors}</td>
                  <td className="right num">{rupee(c.bookingFee + c.platformFee)}</td>
                  <td className="right num">{rupee(c.bookingFee)}</td>
                  <td className="right num">{c.logins || <Pill tone="warn">None</Pill>}</td>
                  <td>{c.visible ? <Pill tone="good">Shown</Pill> : <Pill tone="plain">Hidden</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </>
  );
}
