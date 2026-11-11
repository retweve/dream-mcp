#!/usr/bin/env node
/**
 * 从 inbox/ 重建 index.jsonl —— PR 合并后跑一次。
 * 幂等：重复运行结果一致；按 submittedAt 排序。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.env.DREAM_HOME || path.resolve(process.cwd(), 'dream', 'shared');
const INBOX = path.join(ROOT, 'inbox');
const INDEX = path.join(ROOT, 'index.jsonl');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

if (!fs.existsSync(INBOX)) { console.error('no inbox at', INBOX); process.exit(2); }

const records = [];
for (const f of fs.readdirSync(INBOX).filter(f => f.endsWith('.json'))) {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(INBOX, f), 'utf8'));
    if (!r.id || !r.author || !Array.isArray(r.entries)) { console.warn('skip invalid:', f); continue; }
    records.push(r);
  } catch (e) { console.warn('skip unreadable:', f, e.message); }
}
records.sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));

const rows = records.map(r => ({
  id: r.id,
  author: r.author,
  title: r.title,
  submittedAt: r.submittedAt,
  contentHash: r.contentHash || sha(JSON.stringify({
    author: r.author, title: r.title, summary: r.summary, entries: r.entries, tags: r.tags, lineage: r.lineage,
  })),
  entries: r.entries.length,
  tags: r.tags || [],
  types: [...new Set(r.entries.map(e => e.type || 'fact'))],
}));
fs.writeFileSync(INDEX, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
console.log(JSON.stringify({ records: rows.length, index: INDEX }, null, 2));
