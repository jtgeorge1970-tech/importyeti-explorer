'use client';

import { useState } from 'react';

export default function Home() {
  const [result, setResult] = useState('Ready to test the server bridge.');
  const [busy, setBusy] = useState(false);

  async function testBridge() {
    setBusy(true);
    setResult('Testing…');
    try {
      const r = await fetch('/api/importyeti?path=/api/importers&pageSize=1', { cache: 'no-store' });
      const body = await r.json();
      setResult(JSON.stringify(body, null, 2));
    } catch (e) {
      setResult(String(e));
    } finally {
      setBusy(false);
    }
  }

  return <main style={{fontFamily:'system-ui',maxWidth:900,margin:'48px auto',padding:24}}>
    <h1>BTA ImportYeti Explorer</h1>
    <p>Server-side bridge is installed. The API credential remains on Vercel and is never sent to the browser.</p>
    <button onClick={testBridge} disabled={busy} style={{padding:'12px 18px',fontSize:16}}>{busy ? 'Testing…' : 'Test ImportYeti Bridge'}</button>
    <pre style={{marginTop:24,padding:18,background:'#f4f4f4',overflow:'auto',whiteSpace:'pre-wrap'}}>{result}</pre>
  </main>;
}
