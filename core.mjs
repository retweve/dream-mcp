/**
 * dream-mcp core —— 存储、校验、脱敏、同意模型。
 * server.mjs（MCP stdio）与 http.mjs（HTTP intake）都只做协议适配，逻辑在这里。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = process.env.DREAM_HOME || path.resolve(process.cwd(), 'dream', 'shared');
export const INBOX = path.join(ROOT, 'inbox');
export const INDEX = path.join(ROOT, 'index.jsonl');
export const LIMITS = { body: 64 * 1024, entries: 50, text: 300, title: 120, summary: 800, tags: 8 };

fs.mkdirSync(INBOX, { recursive: true });

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const nowISO = () => new Date().toISOString();
const slug = (s) => String(s || 'dream').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'dream';

// ---------- 强制脱敏（写入前完成，原文不落盘） ----------
const REDACTIONS = [
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]'],
  [/\b1[3-9]\d{9}\b/g, '[phone]'],
  [/\b\d{17}[\dXx]\b/g, '[id]'],
  [/\b(sk-[A-Za-z0-9_-]{4,}|ghp_[A-Za-z0-9]{16,}|gho_[A-Za-z0-9]{16,}|xoxb-[A-Za-z0-9-]{10,}|AKIA[A-Z0-9]{12,})\b/g, '[secret]'],
  [/([?&](?:token|key|api[_-]?key|access[_-]?token|secret|sig|signature)=)[^&\s"'<>]+/gi, '$1[secret]'],
  [/\b(10\.\d{1,3}|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g, '[ip]'],
  [/\b[a-f0-9]{32,}\b/gi, '[hex]'],
];
export function sanitize(s) {
  if (typeof s !== 'string') return s;
  let out = s;
  for (const [re, tag] of REDACTIONS) out = out.replace(re, tag);
  return out;
}

export class DreamError extends Error {
  constructor(code, message) { super(message); this.rpcCode = code; }
}
const fail = (c, m) => { throw new DreamError(c, m); };

function readIndex() {
  if (!fs.existsSync(INDEX)) return [];
  return fs.readFileSync(INDEX, 'utf8').trim().split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) fail(-32602, 'entries must be a non-empty array');
  if (entries.length > LIMITS.entries) fail(-32602, `entries exceeds ${LIMITS.entries}`);
  return entries.map((e, i) => {
    if (!e || typeof e !== 'object') fail(-32602, `entries[${i}] must be an object`);
    const text = String(e.text ?? '').trim();
    if (!text) fail(-32602, `entries[${i}].text is required`);
    if (text.length > LIMITS.text) fail(-32602, `entries[${i}].text exceeds ${LIMITS.text} chars`);
    const type = ['fact', 'decision', 'preference', 'lesson', 'rule', 'warning', 'theory', 'plan'].includes(e.type) ? e.type : 'fact';
    const confidence = ['confirmed', 'unconfirmed', 'theory'].includes(e.confidence) ? e.confidence : 'unconfirmed';
    return { text: sanitize(text), type, confidence, source: e.source ? sanitize(String(e.source).slice(0, 200)) : null };
  });
}

// ---------- 四个操作 ----------
export function submitDream(args = {}) {
  const author = String(args.author ?? '').trim();
  if (!author) fail(-32602, 'author is required (who is dreaming?)');
  const title = sanitize(String(args.title ?? '').trim());
  if (!title) fail(-32602, 'title is required');
  if (title.length > LIMITS.title) fail(-32602, `title exceeds ${LIMITS.title} chars`);
  const summary = sanitize(String(args.summary ?? '').trim());
  if (summary.length > LIMITS.summary) fail(-32602, `summary exceeds ${LIMITS.summary} chars`);
  const entries = normalizeEntries(args.entries);
  const tags = Array.isArray(args.tags) ? args.tags.slice(0, LIMITS.tags).map(t => String(t).slice(0, 32)) : [];
  const lineage = args.lineage && typeof args.lineage === 'object'
    ? { parent: args.lineage.parent ? String(args.lineage.parent).slice(0, 80) : null, generation: Number(args.lineage.generation) || null }
    : null;

  const c = args.consent && typeof args.consent === 'object' ? args.consent : {};
  const consent = { share: c.share !== false, derivatives: c.derivatives === true, anonymize: c.anonymize !== false };
  if (!consent.share) fail(-32602, 'consent.share is false: this pool only stores records meant to be shared');

  const body = { author, title, summary, entries, tags, lineage, consent };
  const raw = JSON.stringify(body);
  if (Buffer.byteLength(raw) > LIMITS.body) fail(-32602, `dream exceeds ${LIMITS.body} bytes`);

  const hash = sha(raw);
  const dupe = readIndex().find(r => r.contentHash === hash);
  if (dupe) return { duplicate: true, id: dupe.id, submittedAt: dupe.submittedAt, note: 'identical dream already in the pool' };

  const stamp = nowISO().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
  const id = `dream-${stamp}-${slug(title)}-${hash.slice(0, 6)}`;
  const record = { id, ...body, submittedAt: nowISO(), contentHash: hash, schema: 1 };
  fs.writeFileSync(path.join(INBOX, `${id}.json`), JSON.stringify(record, null, 2) + '\n', 'utf8');
  fs.appendFileSync(INDEX, JSON.stringify({
    id, author, title, submittedAt: record.submittedAt, contentHash: hash,
    entries: entries.length, tags, types: [...new Set(entries.map(e => e.type))], derivatives: consent.derivatives,
  }) + '\n', 'utf8');
  return { id, submittedAt: record.submittedAt, entries: entries.length, path: path.join(INBOX, `${id}.json`) };
}

export function listDreams(args = {}) {
  const limit = Math.min(Number(args.limit) || 20, 100);
  let rows = readIndex().reverse();
  if (args.author) rows = rows.filter(r => r.author === String(args.author));
  if (args.tag) rows = rows.filter(r => (r.tags || []).includes(String(args.tag)));
  return { total: rows.length, returned: Math.min(limit, rows.length), dreams: rows.slice(0, limit) };
}

export function getDream(args = {}) {
  const id = String(args.id ?? '').trim();
  if (!id || !/^dream-[A-Za-z0-9\-]+$/.test(id)) fail(-32602, 'valid id is required');
  const p = path.join(INBOX, `${id}.json`);
  if (!fs.existsSync(p)) fail(-32602, `dream not found: ${id}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function dreamStats() {
  const rows = readIndex();
  const byAuthor = {};
  const byType = {};
  for (const r of rows) {
    byAuthor[r.author] = (byAuthor[r.author] || 0) + 1;
    for (const t of r.types || []) byType[t] = (byType[t] || 0) + 1;
  }
  return {
    totalDreams: rows.length,
    authors: Object.keys(byAuthor).length,
    byAuthor,
    entriesByType: byType,
    derivativesAllowed: rows.filter(r => r.derivatives === true).length,
    latest: rows.length ? rows[rows.length - 1].submittedAt : null,
    storage: ROOT,
  };
}

export const TOOL_DEFS = [
  {
    name: 'dream_submit',
    description: 'Submit a dream record to the shared pool. A dream = a batch of distilled, durable memory entries from one agent session, with provenance and consent.',
    inputSchema: {
      type: 'object',
      properties: {
        author: { type: 'string' },
        title: { type: 'string' },
        summary: { type: 'string' },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              type: { type: 'string', enum: ['fact', 'decision', 'preference', 'lesson', 'rule', 'warning', 'theory', 'plan'] },
              confidence: { type: 'string', enum: ['confirmed', 'unconfirmed', 'theory'] },
              source: { type: 'string' },
            },
            required: ['text'],
            additionalProperties: false,
          },
        },
        tags: { type: 'array', items: { type: 'string' } },
        lineage: { type: 'object', properties: { parent: { type: 'string' }, generation: { type: 'number' } }, additionalProperties: false },
        consent: {
          type: 'object',
          description: 'share (required true), derivatives (default false), anonymize (default true)',
          properties: { share: { type: 'boolean' }, derivatives: { type: 'boolean' }, anonymize: { type: 'boolean' } },
          additionalProperties: false,
        },
      },
      required: ['author', 'title', 'entries'],
      additionalProperties: false,
    },
  },
  { name: 'dream_list', description: 'List dreams, newest first.', inputSchema: { type: 'object', properties: { limit: { type: 'number' }, author: { type: 'string' }, tag: { type: 'string' } }, additionalProperties: false } },
  { name: 'dream_get', description: 'Fetch one dream by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { name: 'dream_stats', description: 'Aggregate stats for the pool.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];
