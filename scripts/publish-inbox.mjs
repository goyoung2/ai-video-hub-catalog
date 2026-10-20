import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KINDS = new Set(['new','changed','ended','resumed','review']);
const GRADES = new Set(['A','B','C','U','X']);
const MAX_BYTES = 2_000_000;
const file = p => path.join(ROOT, p);

function httpsUrl(v) {
  if (typeof v !== 'string' || v.length > 2048) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && Boolean(u.hostname) && !u.username && !u.password;
  } catch { return false; }
}

export function validate(doc) {
  if (!doc || doc.schemaVersion !== 1 || !Array.isArray(doc.entries)
    || doc.entries.length > 2000 || !Number.isFinite(Date.parse(doc.generatedAt))) {
    throw new Error('Invalid feed header');
  }
  const keys = new Set();
  for (const e of doc.entries) {
    if (!e || !/^[A-Za-z0-9_.:-]{3,120}$/.test(e.key || '') || keys.has(e.key))
      throw new Error('Invalid or duplicate change key');
    keys.add(e.key);
    if (!KINDS.has(e.kind) || !e.site || !httpsUrl(e.site.url)
      || typeof e.site.name !== 'string' || !e.site.name.trim())
      throw new Error('Invalid change type or site');
    if (e.site.id != null && !/^[A-Za-z0-9_-]{1,90}$/.test(String(e.site.id)))
      throw new Error('Invalid site ID');
    if (e.site.grade != null && !GRADES.has(e.site.grade))
      throw new Error('Invalid grade');
    if (!Array.isArray(e.evidence) || !e.evidence.length || e.evidence.length > 8
      || !e.evidence.every(httpsUrl)) throw new Error('Missing verified HTTPS evidence');
    if (e.site.sources != null && (!Array.isArray(e.site.sources)
      || e.site.sources.length > 10 || !e.site.sources.every(httpsUrl)))
      throw new Error('Invalid site source links');
    if (JSON.stringify(e).length > 14000) throw new Error('Oversized change entry');
  }
  if (Buffer.byteLength(JSON.stringify(doc)) > MAX_BYTES) throw new Error('Feed too large');
  return doc;
}

export function merge(oldDoc, proposals) {
  validate(oldDoc);
  const indexed = new Map(oldDoc.entries.map(e => [e.key, e]));
  for (const doc of proposals) {
    for (const e of validate(doc).entries) {
      if (indexed.has(e.key) && JSON.stringify(indexed.get(e.key)) !== JSON.stringify(e))
        throw new Error('Conflicting proposal key: ' + e.key);
      indexed.set(e.key, e);
    }
  }
  const changed = indexed.size !== oldDoc.entries.length;
  const output = {
    schemaVersion: 1,
    generatedAt: changed ? new Date().toISOString() : oldDoc.generatedAt,
    entries: [...indexed.values()]
  };
  validate(output);
  return { output, changed };
}

export function run({check = false} = {}) {
  const oldDoc = JSON.parse(fs.readFileSync(file('feeds/updates.json'), 'utf8'));
  const inboxDir = file('feeds/inbox');
  const names = fs.readdirSync(inboxDir).filter(x => x.endsWith('.json')).sort();
  const docs = names.map(x => JSON.parse(fs.readFileSync(path.join(inboxDir, x), 'utf8')));
  const { output, changed } = merge(oldDoc, docs);
  console.log(names.length + ' inbox files, ' + output.entries.length + ' proposals, changed=' + changed);
  if (changed && !check) fs.writeFileSync(file('feeds/updates.json'), JSON.stringify(output, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  run({check: process.argv.includes('--check')});
