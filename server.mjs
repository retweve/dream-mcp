#!/usr/bin/env node
/**
 * dream-mcp —— 共享梦境池的 MCP 服务器（零依赖，stdio JSON-RPC）。
 *
 * 存在的理由：GitHub 上的 dream 类 MCP（dream-mcp / Pseudolife / Mnemosyne）
 * 都是「单机记忆」，没有一个是「让别人把 dream 记录交进来」的共享入口。
 * 这个服务器只做一件事：收梦、列梦、取梦、统计。
 *
 * 协议：MCP over stdio（换行分隔的 JSON-RPC 2.0）
 * 存储：$DREAM_HOME（默认 <workspace>/dream/shared）
 *   inbox/<id>.json   每条梦一个文件（不可变，git 友好）
 *   index.jsonl       追加索引，一行一条
 *
 * 安全边界：
 *   - 单条 ≤ 64KB、entries ≤ 50、每条 text ≤ 300 字符
 *   - 不做代码执行、不读写 inbox 之外的路径
 *   - 内容当数据存，不做任何解释执行
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';

const ROOT = process.env.DREAM_HOME || path.resolve(process.cwd(), 'dream', 'shared');
const INBOX = path.join(ROOT, 'inbox');
const INDEX = path.join(ROOT, 'index.jsonl');
const LIMITS = { body: 64 * 1024, entries: 50, text: 300, title: 120, summary: 800, tags: 8 };

fs.mkdirSync(INBOX, { recursive: true });

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const nowISO = () => new Date().toISOString();
const slug = (s) => String(s || 'dream').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'dream';

// ---------- 强制脱敏 ----------
// 脱敏在写入前完成：原文不落盘。这是底线，不依赖提交者自觉。
const REDACTIONS = [
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]'],
  [/\b1[3-9]\d{9}\b/g, '[phone]'],
  [/\b\d{17}[\dXx]\b/g, '[id]'],
  [/\b(sk-[A-Za-z0-9_-]{4,}|ghp_[A-Za-z0-9]{16,}|gho_[A-Za-z0-9]{16,}|xoxb-[A-Za-z0-9-]{10,}|AKIA[A-Z0-9]{12,})\b/g, '[secret]'],
  [/([?&](?:token|key|api[_-]?key|access[_-]?token|secret|sig|signature)=)[^&\s"'<>]+/gi, '$1[secret]'],
  [/\b(10\.\d{1,3}|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g, '[ip]'],
  [/\b[a-f0-9]{32,}\b/gi, '[hex]'],
];
function sanitize(s) {
  if (typeof s !== 'string') return s;
  let out = s;
  for (const [re, tag] of REDACTIONS) out = out.replace(re, tag);
  return out;
}

function fail(code, message) {
  const e = new Error(message);
  e.rpcCode = code;
  return e;
}

function readIndex() {
  if (!fs.existsSync(INDEX)) return [];
  return fs.readFileSync(INDEX, 'utf8').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function appendIndex(rec) {
  fs.appendFileSync(INDEX, JSON.stringify(rec) + '\n', 'utf8');
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw fail(-32602, 'entries must be a non-empty array');
  if (entries.length > LIMITS.entries) throw fail(-32602, `entries exceeds ${LIMITS.entries}`);
  return entries.map((e, i) => {
    if (!e || typeof e !== 'object') throw fail(-32602, `entries[${i}] must be an object`);
    const text = String(e.text ?? '').trim();
    if (!text) throw fail(-32602, `entries[${i}].text is required`);
    if (text.length > LIMITS.text) throw fail(-32602, `entries[${i}].text exceeds ${LIMITS.text} chars`);
    const type = ['fact', 'decision', 'preference', 'lesson', 'rule', 'warning', 'theory', 'plan'].includes(e.type) ? e.type : 'fact';
    const confidence = ['confirmed', 'unconfirmed', 'theory'].includes(e.confidence) ? e.confidence : 'unconfirmed';
    return { text: sanitize(text), type, confidence, source: e.source ? sanitize(String(e.source).slice(0, 200)) : null };
  });
}

// ---------- 工具实现 ----------
const tools = {
  dream_submit(args) {
    const author = String(args.author ?? '').trim();
    if (!author) throw fail(-32602, 'author is required (who is dreaming?)');
    const title = sanitize(String(args.title ?? '').trim());
    if (!title) throw fail(-32602, 'title is required');
    if (title.length > LIMITS.title) throw fail(-32602, `title exceeds ${LIMITS.title} chars`);
    const summary = sanitize(String(args.summary ?? '').trim());
    if (summary.length > LIMITS.summary) throw fail(-32602, `summary exceeds ${LIMITS.summary} chars`);
    const entries = normalizeEntries(args.entries);
    const tags = Array.isArray(args.tags) ? args.tags.slice(0, LIMITS.tags).map(t => String(t).slice(0, 32)) : [];
    const lineage = args.lineage && typeof args.lineage === 'object'
      ? { parent: args.lineage.parent ? String(args.lineage.parent).slice(0, 80) : null, generation: Number(args.lineage.generation) || null }
      : null;

    // 同意模型：share 必须为真；derivatives 默认 false（不参与聚合派生）
    const c = args.consent && typeof args.consent === 'object' ? args.consent : {};
    const consent = { share: c.share !== false, derivatives: c.derivatives === true, anonymize: c.anonymize !== false };
    if (!consent.share) throw fail(-32602, 'consent.share is false: this pool only stores records meant to be shared');

    const body = { author, title, summary, entries, tags, lineage, consent };
    const raw = JSON.stringify(body);
    if (Buffer.byteLength(raw) > LIMITS.body) throw fail(-32602, `dream exceeds ${LIMITS.body} bytes`);

    const hash = sha(raw);
    const dupe = readIndex().find(r => r.contentHash === hash);
    if (dupe) return { duplicate: true, id: dupe.id, submittedAt: dupe.submittedAt, note: 'identical dream already in the pool' };

    const stamp = nowISO().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
    const id = `dream-${stamp}-${slug(title)}-${hash.slice(0, 6)}`;
    const record = { id, ...body, submittedAt: nowISO(), contentHash: hash, schema: 1 };
    fs.writeFileSync(path.join(INBOX, `${id}.json`), JSON.stringify(record, null, 2) + '\n', 'utf8');
    appendIndex({
      id, author, title, submittedAt: record.submittedAt, contentHash: hash,
      entries: entries.length,
      tags,
      types: [...new Set(entries.map(e => e.type))],
      derivatives: consent.derivatives,
    });
    return { id, submittedAt: record.submittedAt, entries: entries.length, path: path.join(INBOX, `${id}.json`) };
  },

  dream_list(args) {
    const limit = Math.min(Number(args.limit) || 20, 100);
    const author = args.author ? String(args.author) : null;
    const tag = args.tag ? String(args.tag) : null;
    let rows = readIndex().reverse();
    if (author) rows = rows.filter(r => r.author === author);
    if (tag) rows = rows.filter(r => (r.tags || []).includes(tag));
    return { total: rows.length, returned: Math.min(limit, rows.length), dreams: rows.slice(0, limit) };
  },

  dream_get(args) {
    const id = String(args.id ?? '').trim();
    if (!id || !/^dream-[A-Za-z0-9\-]+$/.test(id)) throw fail(-32602, 'valid id is required');
    const p = path.join(INBOX, `${id}.json`);
    if (!fs.existsSync(p)) throw fail(-32602, `dream not found: ${id}`);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  },

  dream_stats() {
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
      latest: rows.length ? rows[rows.length - 1].submittedAt : null,
      storage: ROOT,
    };
  },
};

const TOOL_DEFS = [
  {
    name: 'dream_submit',
    description: 'Submit a dream record to the shared pool. A dream = a batch of distilled, durable memory entries from one agent session, with provenance.',
    inputSchema: {
      type: 'object',
      properties: {
        author: { type: 'string', description: 'Who is dreaming (agent or person name)' },
        title: { type: 'string', description: 'Short title of the dream' },
        summary: { type: 'string', description: 'What was consolidated and why it matters' },
        entries: {
          type: 'array',
          description: 'Distilled memory entries (1-50)',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'One fact/decision/lesson, <=300 chars' },
              type: { type: 'string', enum: ['fact', 'decision', 'preference', 'lesson', 'rule', 'warning', 'theory', 'plan'] },
              confidence: { type: 'string', enum: ['confirmed', 'unconfirmed', 'theory'] },
              source: { type: 'string', description: 'Where it came from (session id, url, file)' },
            },
            required: ['text'],
            additionalProperties: false,
          },
        },
        tags: { type: 'array', items: { type: 'string' } },
        lineage: {
          type: 'object',
          properties: { parent: { type: 'string' }, generation: { type: 'number' } },
          additionalProperties: false,
        },
        consent: {
          type: 'object',
          description: 'share (required true), derivatives (default false), anonymize (default true)',
          properties: {
            share: { type: 'boolean' },
            derivatives: { type: 'boolean' },
            anonymize: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
      required: ['author', 'title', 'entries'],
      additionalProperties: false,
    },
  },
  {
    name: 'dream_list',
    description: 'List dreams in the shared pool, newest first.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' }, author: { type: 'string' }, tag: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'dream_get',
    description: 'Fetch one full dream record by id.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'dream_stats',
    description: 'Aggregate stats for the shared dream pool.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

// ---------- JSON-RPC over stdio ----------
function reply(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(req) {
  const { id, method, params } = req;
  const isNotification = id === undefined || id === null;

  if (method === 'initialize') {
    return { jsonrpc: '2.0', id, result: {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'dream-mcp', version: '1.0.0' },
    } };
  }
  if (method === 'notifications/initialized' || method === 'initialized') return null;
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOL_DEFS } };
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments || {};
    const fn = tools[name];
    if (!fn) return { jsonrpc: '2.0', id, error: { code: -32601, message: `unknown tool: ${name}` } };
    try {
      const out = await fn(args);
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out } };
    } catch (e) {
      return { jsonrpc: '2.0', id, error: { code: e.rpcCode || -32603, message: e.message } };
    }
  }
  if (isNotification) return null;
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try { req = JSON.parse(trimmed); }
  catch { reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); return; }
  const res = await handle(req);
  if (res) reply(res);
});
rl.on('close', () => process.exit(0));
