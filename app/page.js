'use client';

import { useMemo, useState } from 'react';

const tiers = [
  { key: 'call', label: 'Call Ready', hint: 'Strong fit + usable contact path' },
  { key: 'qualified', label: 'Qualified', hint: 'Good importer, needs contact research' },
  { key: 'research', label: 'Research', hint: 'Potential fit, verify before outreach' },
  { key: 'replace', label: 'Replace', hint: 'Weak fit / insufficient evidence' },
];

function normalize(body) {
  const source = body?.data ?? body?.results ?? body?.importers ?? body;
  const rows = Array.isArray(source) ? source : Array.isArray(source?.data) ? source.data : [];
  return rows.map((x, i) => ({
    id: x.id ?? x.importer_id ?? x.slug ?? i,
    company: x.name ?? x.company_name ?? x.importer_name ?? x.company ?? 'Unknown importer',
    country: x.country ?? x.country_name ?? x.origin_country ?? '—',
    shipments: x.shipments ?? x.shipment_count ?? x.total_shipments ?? '—',
    address: x.address ?? x.full_address ?? x.location ?? '—',
    website: x.website ?? x.domain ?? '—',
    raw: x,
  }));
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bucket, setBucket] = useState({});
  const [selected, setSelected] = useState(null);

  async function search(e) {
    e?.preventDefault();
    setBusy(true); setError('');
    try {
      const qs = new URLSearchParams({ path: '/api/importers', pageSize: '25' });
      if (query.trim()) qs.set('search', query.trim());
      const r = await fetch('/api/importyeti?' + qs.toString(), { cache: 'no-store' });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.error || body?.message || 'Importer search failed');
      setRows(normalize(body));
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  }

  const counts = useMemo(() => tiers.reduce((a,t) => ({...a,[t.key]:Object.values(bucket).filter(v=>v===t.key).length}),{}), [bucket]);

  return <main className="shell">
    <style>{`
      *{box-sizing:border-box} body{margin:0;background:#f5f7fa;color:#152033;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}.shell{max-width:1180px;margin:auto;padding:32px 20px 70px}.top{display:flex;justify-content:space-between;gap:20px;align-items:flex-end}.eyebrow{font-size:12px;font-weight:800;letter-spacing:.12em;color:#51617a;text-transform:uppercase}.top h1{margin:5px 0 4px;font-size:34px}.sub{margin:0;color:#64748b}.badge{background:#e8fff2;color:#087443;border:1px solid #b9efd0;padding:8px 12px;border-radius:999px;font-weight:750;font-size:13px}.search{display:flex;gap:10px;margin:26px 0 18px;background:white;padding:12px;border:1px solid #dce3eb;border-radius:14px;box-shadow:0 4px 16px #1d29390b}.search input{flex:1;border:0;outline:0;font-size:16px;padding:10px}.search button,.small{border:0;background:#152033;color:white;border-radius:9px;padding:11px 18px;font-weight:750;cursor:pointer}.search button:disabled{opacity:.55}.tiers{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}.tier{background:white;border:1px solid #dce3eb;border-radius:12px;padding:14px}.tier strong{display:block;font-size:15px}.tier span{display:block;color:#738096;font-size:12px;margin-top:4px}.count{float:right;background:#eef2f7;padding:3px 8px;border-radius:99px}.panel{background:white;border:1px solid #dce3eb;border-radius:14px;overflow:hidden}.empty{padding:48px;text-align:center;color:#718096}.error{background:#fff0f0;color:#a12424;border:1px solid #f1c2c2;padding:12px;border-radius:10px;margin-bottom:14px}.row{display:grid;grid-template-columns:2.1fr .8fr .7fr 1.4fr;gap:12px;padding:15px 18px;border-top:1px solid #edf0f4;align-items:center}.row:first-child{border-top:0}.company{font-weight:800;cursor:pointer}.meta{font-size:12px;color:#718096;margin-top:3px}.ship{text-align:right;font-weight:700}.actions{display:flex;gap:5px;flex-wrap:wrap}.actions button{border:1px solid #d4dbe5;background:#fff;border-radius:7px;padding:6px 8px;font-size:11px;font-weight:700}.actions button.active{background:#152033;color:#fff}.drawer{margin-top:18px;background:#111827;color:#eef2ff;border-radius:14px;padding:20px}.drawer pre{white-space:pre-wrap;overflow:auto;font-size:12px;color:#cbd5e1}.close{float:right;background:#334155;color:white;border:0;border-radius:7px;padding:6px 10px}@media(max-width:760px){.top{align-items:flex-start;flex-direction:column}.tiers{grid-template-columns:1fr 1fr}.row{grid-template-columns:1fr}.ship{text-align:left}.top h1{font-size:28px}}
    `}</style>
    <header className="top"><div><div className="eyebrow">Business Tax Advisers · Importer Intelligence</div><h1>BTA Importer Explorer</h1><p className="sub">Find importers, qualify opportunities, and build a call-ready pipeline.</p></div><div className="badge">● ImportYeti bridge connected</div></header>

    <form className="search" onSubmit={search}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search company, product, HS code, supplier…"/><button disabled={busy}>{busy?'Searching…':'Search Importers'}</button></form>
    {error && <div className="error">{error}</div>}

    <section className="tiers">{tiers.map(t=><div className="tier" key={t.key}><b className="count">{counts[t.key]||0}</b><strong>{t.label}</strong><span>{t.hint}</span></div>)}</section>

    <section className="panel">{rows.length===0 ? <div className="empty"><b>Importer search is ready.</b><br/>Enter a company, product, HS code, or supplier above to build the working list.</div> : rows.map(r=><div className="row" key={r.id}>
      <div><div className="company" onClick={()=>setSelected(r)}>{r.company}</div><div className="meta">{r.address}</div></div>
      <div><div>{r.country}</div><div className="meta">{r.website}</div></div>
      <div className="ship">{r.shipments}<div className="meta">shipments</div></div>
      <div className="actions">{tiers.map(t=><button type="button" className={bucket[r.id]===t.key?'active':''} key={t.key} onClick={()=>setBucket({...bucket,[r.id]:t.key})}>{t.label}</button>)}</div>
    </div>)}</section>

    {selected && <section className="drawer"><button className="close" onClick={()=>setSelected(null)}>Close</button><h2>{selected.company}</h2><p>{selected.address} · {selected.country}</p><pre>{JSON.stringify(selected.raw,null,2)}</pre></section>}
  </main>;
}
