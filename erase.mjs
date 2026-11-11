#!/usr/bin/env node
/**
 * 删除证明（GDPR Art.17 用）：删记录 → 写 tombstone → 重建索引 → 断言零残留。
 *
 *   node erase.mjs --id <dream-id> --yes
 *   node erase.mjs --author <author> --yes
 *   node erase.mjs --id <dream-id> --dry-run
 *
 * 零残留断言（不含 tombstone 中的 id/hash 引用）：
 *   1. inbox/ 下无该 id 文件
 *   2. index.jsonl 无该 id 行
 *   3. 除 tombstones.jsonl 外，shared/ 内不出现该记录的 contentHash 与任一条目正文
 *   4. 打印删除前后树大小与摘要
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, INBOX, INDEX } from './core.mjs';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const DRY = process.argv.includes('--dry-run');
const YES = process.argv.includes('--yes');
const TOMBSTONES = path.join(ROOT, 'tombstones.jsonl');

function loadRecords() {
  if (!fs.existsSync(INBOX)) return [];
  return fs.readdirSync(INBOX).filter(f => f.endsWith('.json'))
    .map(f => ({ f, rec: JSON.parse(fs.readFileSync(path.join(INBOX, f), 'utf8')) }));
}

const id = arg('id');
const author = arg('author');
if (!id && !author) { console.error('usage: --id <id> | --author <name>  [--dry-run|--yes]'); process.exit(2); }
if (!DRY && !YES) { console.error('refusing to erase: pass --yes (or --dry-run)'); process.exit(2); }

const all = loadRecords();
const targets = all.filter(({ rec }) => (id && rec.id === id) || (author && rec.author === author));
if (!targets.length) { console.error('no matching records'); process.exit(2); }

const summary = { dryRun: DRY, matched: targets.length, ids: targets.map(t => t.rec.id), treeBefore: all.length };
console.log(JSON.stringify(summary, null, 2));
if (DRY) process.exit(0);

const now = new Date().toISOString();
for (const { f, rec } of targets) {
  fs.appendFileSync(TOMBSTONES, JSON.stringify({
    id: rec.id, author: rec.author, contentHash: rec.contentHash, hashAlg: rec.hashAlg || 'legacy',
    erasedAt: now, reason: id ? 'request-by-id' : 'request-by-author',
  }) + '\n', 'utf8');
  fs.rmSync(path.join(INBOX, f), { force: true });
}

// 重建索引
const remaining = loadRecords().map(x => x.rec)
  .sort((a, b) => (a.submittedAt || '').localeCompare(b.submittedAt || '') || a.id.localeCompare(b.id));
fs.writeFileSync(INDEX, remaining.map(r => JSON.stringify({
  id: r.id, author: r.author, title: r.title, submittedAt: r.submittedAt,
  contentHash: r.contentHash, hashAlg: r.hashAlg || 'legacy', signed: r.signed === true,
  entries: (r.entries || []).length, tags: r.tags || [],
  types: [...new Set((r.entries || []).map(e => e.type || 'fact'))],
  derivatives: r.consent?.derivatives === true,
})).join('\n') + (remaining.length ? '\n' : ''), 'utf8');

// 零残留断言
const failures = [];
const targetIds = new Set(targets.map(t => t.rec.id));
const targetHashes = new Set(targets.map(t => t.rec.contentHash).filter(Boolean));
const targetTexts = targets.flatMap(t => (t.rec.entries || []).map(e => e.text)).filter(t => t && t.length >= 12);

for (const f of fs.readdirSync(INBOX)) {
  const rec = JSON.parse(fs.readFileSync(path.join(INBOX, f), 'utf8'));
  if (targetIds.has(rec.id)) failures.push(`inbox still contains ${rec.id}`);
}
if (fs.existsSync(INDEX)) {
  for (const line of fs.readFileSync(INDEX, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    if (targetIds.has(row.id)) failures.push(`index still contains ${row.id}`);
  }
}
for (const f of fs.readdirSync(ROOT)) {
  if (f === 'tombstones.jsonl' || f === 'inbox' || f === 'keys') continue;
  const p = path.join(ROOT, f);
  if (!fs.statSync(p).isFile()) continue;
  const text = fs.readFileSync(p, 'utf8');
  for (const h of targetHashes) if (text.includes(h)) failures.push(`${f} still references hash ${h.slice(0, 12)}`);
  for (const t of targetTexts) if (text.includes(t)) failures.push(`${f} still contains erased entry text`);
}

const result = { erased: targets.length, treeAfter: remaining.length, tombstoneCount: fs.readFileSync(TOMBSTONES, 'utf8').trim().split('\n').filter(Boolean).length, residueChecks: failures.length ? 'FAIL' : 'PASS', failures };
console.log(JSON.stringify(result, null, 2));
process.exit(failures.length ? 1 : 0);
