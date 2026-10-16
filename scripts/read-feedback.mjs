#!/usr/bin/env node
// Lists/prints TrueAIGaming feedback from the private Vercel Blob store.
// Token is read from BLOB_TOKEN_FILE (default ~/.config/trueaigaming/blob-token).
// The token is never printed or logged.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { list } from '@vercel/blob';

const args = process.argv.slice(2);
let print = false, since = null, prefix = 'feedback/';
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--print' || a === '-p') print = true;
  else if (a === '--since') { since = new Date(args[++i]); if (isNaN(since)) { console.error('error: bad --since ISO date'); process.exit(2); } }
  else if (a === '--prefix') prefix = args[++i];
  else { console.error(`Unknown arg: ${a}`); process.exit(2); }
}

const file = process.env.BLOB_TOKEN_FILE || `${homedir()}/.config/trueaigaming/blob-token`;
let token;
try { token = readFileSync(file, 'utf8').trim(); } catch { console.error(`error: cannot read token file ${file}`); process.exit(1); }
if (!token) { console.error('error: token file empty'); process.exit(1); }

const blobs = [];
let cursor;
do {
  const r = await list({ token, prefix, cursor, limit: 1000 });
  blobs.push(...r.blobs);
  cursor = r.hasMore ? r.cursor : undefined;
} while (cursor);

const rows = blobs
  .filter(b => !since || new Date(b.uploadedAt) >= since)
  .sort((a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt));

console.log(`${rows.length} file(s) under ${prefix}${since ? ` since ${since.toISOString()}` : ''}`);
for (const b of rows) {
  console.log(`${b.uploadedAt instanceof Date ? b.uploadedAt.toISOString() : b.uploadedAt}  ${String(b.size).padStart(6)}  ${b.pathname}`);
  if (print) {
    const res = await fetch(b.downloadUrl || b.url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) { console.log(`  (fetch failed: HTTP ${res.status})`); continue; }
    const text = await res.text();
    try { console.log(JSON.stringify(JSON.parse(text), null, 2).replace(/^/gm, '  ')); }
    catch { console.log(text.replace(/^/gm, '  ')); }
  }
}
