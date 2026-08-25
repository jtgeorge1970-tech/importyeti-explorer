import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL = process.env.IMPORTYETI_API_BASE_URL || 'https://importyeti-explorer-jpoh2en9h-jtgeorge1970-9095s-projects.vercel.app';

function apiKey() {
  return process.env.BTA_SERVICE_API_KEY || process.env.IMPORTYETI_API_KEY;
}

export async function GET(request) {
  const key = apiKey();
  if (!key) return NextResponse.json({ ok: false, error: 'Server API key is not configured.' }, { status: 503 });

  const incoming = new URL(request.url);
  const path = incoming.searchParams.get('path') || '/api/importers';
  if (!path.startsWith('/') || path.includes('://') || path.includes('..')) {
    return NextResponse.json({ ok: false, error: 'Invalid upstream path.' }, { status: 400 });
  }

  const upstream = new URL(path, BASE_URL);
  for (const [name, value] of incoming.searchParams.entries()) if (name !== 'path' && !name.startsWith('_vercel')) upstream.searchParams.append(name, value);

  try {
    const response = await fetch(upstream, {
      headers: { Accept: 'application/json', 'x-api-key': key },
      cache: 'no-store'
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return NextResponse.json({ ok: response.ok, status: response.status, data }, {
      status: response.ok ? 200 : response.status,
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: 'Upstream request failed.', detail: error.message }, { status: 502 });
  }
}
