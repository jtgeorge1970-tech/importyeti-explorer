import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL = process.env.IMPORTYETI_API_BASE_URL || 'https://data.importyeti.com';

function apiKey() {
  return process.env.IMPORTYETI_API_KEY || process.env.BTA_SERVICE_API_KEY;
}

async function upstreamFetch(url, key) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${key}`, 'x-api-key': key },
    cache: 'no-store'
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { response, data };
}

export async function GET(request) {
  const key = apiKey();
  if (!key) return NextResponse.json({ ok: false, error: 'Server API key is not configured.' }, { status: 503 });

  const incoming = new URL(request.url);
  const requestedPath = incoming.searchParams.get('path');
  const path = requestedPath && requestedPath !== '/api/importers' ? requestedPath : '/v1.0/powerquery/us-import/companies';
  if (!path.startsWith('/') || path.includes('://') || path.includes('..')) return NextResponse.json({ ok: false, error: 'Invalid upstream path.' }, { status: 400 });

  const wanted = Math.min(100, Math.max(1, Number(incoming.searchParams.get('pageSize') || 10)));
  const base = new URL(path, BASE_URL);
  for (const [name, value] of incoming.searchParams.entries()) {
    if (name === 'path' || name === 'pageSize' || name === 'page' || name.startsWith('_vercel')) continue;
    if (name === 'search') base.searchParams.append('query', value); else base.searchParams.append(name, value);
  }

  try {
    const combined = [], seen = new Set();
    let creditsRemaining = null, requestCost = 0, totalCompanies = null, lastStatus = 200;
    // ImportYeti's companies endpoint currently caps each response at 10 even when a larger limit is requested.
    // Walk pages until the requested number of distinct companies is collected.
    for (let page = 1; page <= Math.ceil(wanted / 10) + 2 && combined.length < wanted; page++) {
      const upstream = new URL(base);
      upstream.searchParams.set('limit', '10');
      upstream.searchParams.set('page', String(page));
      const { response, data } = await upstreamFetch(upstream, key);
      lastStatus = response.status;
      if (!response.ok) return NextResponse.json({ ok: false, status: response.status, source: 'importyeti', data }, { status: response.status, headers: { 'Cache-Control': 'no-store' } });
      requestCost += Number(data?.requestCost || 0);
      if (data?.creditsRemaining != null) creditsRemaining = data.creditsRemaining;
      const payload = data?.data?.data ?? data?.data ?? [];
      if (data?.data?.totalCompanies != null) totalCompanies = data.data.totalCompanies;
      if (!Array.isArray(payload) || !payload.length) break;
      let added = 0;
      for (const row of payload) {
        const id = row?.company_link || row?.key || JSON.stringify(row);
        if (seen.has(id)) continue;
        seen.add(id); combined.push(row); added++;
        if (combined.length >= wanted) break;
      }
      if (!added) break;
    }
    return NextResponse.json({ ok: true, status: lastStatus, source: 'importyeti', data: { requestCost, creditsRemaining, data: { data: combined.slice(0, wanted), totalCompanies }, batch: { requested: wanted, returned: Math.min(wanted, combined.length), distinct: seen.size } } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: 'ImportYeti request failed.', detail: error.message }, { status: 502 });
  }
}
