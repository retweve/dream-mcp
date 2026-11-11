/**
 * dream-mcp core —— 存储、校验、脱敏、同意模型。
 * server.mjs（MCP stdio）与 http.mjs（HTTP intake）都只做协议适配，逻辑在这里。
 */
import fs from 'node:fs';
import path from 'node:path';
import { contentHash as jcsHash } from './jcs.mjs';
import { verifyRecordSignature } from './sign.mjs';
import { registerKey, lookupKey, pemFromRaw } from './keys.mjs';
import { prepareBody, sanitize, LIMITS, BodyError } from './body.mjs';

export const ROOT = process.env.DREAM_HOME || path.resolve(process.cwd(), 'dream', 'shared');
export const INBOX = path.join(ROOT, 'inbox');
export const INDEX = path.join(ROOT, 'index.jsonl');
export const HASH_ALG = 'jcs-sha256/v1';
export { LIMITS, sanitize };

fs.mkdirSync(INBOX, { recursive: true });

const nowISO = () => new Date().toISOString();
const slug = (s) => String(s || 'dream').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'dream';

export class DreamError extends Error {
  constructor(code, message) { super(message); this.rpcCode = code; }
}
const fail = (c, m) => { throw new DreamError(c, m); };

function readIndex() {
  if (!fs.existsSync(INDEX)) return [];
  return fs.readFileSync(INDEX, 'utf8').trim().split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// ---------- 四个操作 ----------
export function submitDream(args = {}) {
  // 与 sign.mjs 共用同一份规范化逻辑：签名覆盖的字节 === 存储的字节
  let prepared;
  try {
    prepared = prepareBody(args);
  } catch (e) {
    if (e instanceof BodyError) fail(-32602, e.message);
    throw e;
  }
  const { body } = prepared;
  const { author, title, entries, tags, consent } = body;

  // --- 签名（可选，但只要有就必须合法；不允许匿名伪造作者） ---
  let sig = null;
  let signed = false;
  if (args.sig !== undefined && args.sig !== null) {
    const check = verifyRecordSignature({ ...body, sig: args.sig }, { requireKey: true });
    if (!check.ok) fail(-32602, `invalid signature: ${check.reason}`);
    const registered = lookupKey(check.keyId);
    if (registered && registered.author !== author) {
      fail(-32602, `key ${check.keyId} is registered to a different author`);
    }
    const rawPub = Buffer.from(args.sig.publicKey, 'base64url');
    registerKey({
      keyId: check.keyId,
      publicKeyPem: registered?.publicKey || pemFromRaw(rawPub),
      author,
      note: 'tofu on submit',
    });
    sig = args.sig;
    signed = true;
  }

  const hash = jcsHash(body);

  const dupe = readIndex().find(r => r.contentHash === hash && (r.hashAlg || 'legacy') === HASH_ALG);
  if (dupe) return { duplicate: true, id: dupe.id, submittedAt: dupe.submittedAt, note: 'identical dream already in the pool' };

  const stamp = nowISO().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
  const id = `dream-${stamp}-${slug(title)}-${hash.slice(0, 6)}`;
  const record = { id, ...body, ...(sig ? { sig } : {}), submittedAt: nowISO(), contentHash: hash, hashAlg: HASH_ALG, signed, schema: 2 };
  fs.writeFileSync(path.join(INBOX, `${id}.json`), JSON.stringify(record, null, 2) + '\n', 'utf8');
  fs.appendFileSync(INDEX, JSON.stringify({
    id, author, title, submittedAt: record.submittedAt, contentHash: hash, hashAlg: HASH_ALG, signed,
    entries: entries.length, tags, types: [...new Set(entries.map(e => e.type))], derivatives: consent.derivatives,
  }) + '\n', 'utf8');
  return { id, submittedAt: record.submittedAt, entries: entries.length, signed, hashAlg: HASH_ALG, path: path.join(INBOX, `${id}.json`) };
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
    signedCount: rows.filter(r => r.signed === true).length,
    legacyCount: rows.filter(r => (r.hashAlg || 'legacy') !== HASH_ALG).length,
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
        sig: {
          type: 'object',
          description: 'Ed25519 signature envelope (RFC 8032). See evo/sources/g1-rfc-prerequisites.md §4.',
          properties: {
            alg: { type: 'string', enum: ['ed25519'] },
            keyId: { type: 'string' },
            publicKey: { type: 'string' },
            value: { type: 'string' },
          },
          required: ['alg', 'publicKey', 'value'],
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
