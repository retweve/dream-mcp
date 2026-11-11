/**
 * 提交体规范化（core 与 sign 共用，保证「客户端签名」与「服务端存储」是同一份字节）。
 *
 * 流程：校验 → 强制脱敏 → 补默认字段。签名必须覆盖这里输出的 body。
 */
export const LIMITS = { body: 64 * 1024, entries: 50, text: 300, title: 120, summary: 800, tags: 8 };

export class BodyError extends Error {
  constructor(message) { super(message); this.rpcCode = -32602; }
}
const fail = (m) => { throw new BodyError(m); };

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

function normalizeEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) fail('entries must be a non-empty array');
  if (entries.length > LIMITS.entries) fail(`entries exceeds ${LIMITS.entries}`);
  return entries.map((e, i) => {
    if (!e || typeof e !== 'object') fail(`entries[${i}] must be an object`);
    const text = String(e.text ?? '').trim();
    if (!text) fail(`entries[${i}].text is required`);
    if (text.length > LIMITS.text) fail(`entries[${i}].text exceeds ${LIMITS.text} chars`);
    const type = ['fact', 'decision', 'preference', 'lesson', 'rule', 'warning', 'theory', 'plan'].includes(e.type) ? e.type : 'fact';
    const confidence = ['confirmed', 'unconfirmed', 'theory'].includes(e.confidence) ? e.confidence : 'unconfirmed';
    return { text: sanitize(text), type, confidence, source: e.source ? sanitize(String(e.source).slice(0, 200)) : null };
  });
}

/**
 * 校验并规范化提交体。返回 { body, bytes, hash }，不写盘。
 * sign.mjs 用它签名，core.mjs 用它存储 —— 两边字节完全一致。
 */
export function prepareBody(args = {}) {
  const author = String(args.author ?? '').trim();
  if (!author) fail('author is required (who is dreaming?)');
  const title = sanitize(String(args.title ?? '').trim());
  if (!title) fail('title is required');
  if (title.length > LIMITS.title) fail(`title exceeds ${LIMITS.title} chars`);
  const summary = sanitize(String(args.summary ?? '').trim());
  if (summary.length > LIMITS.summary) fail(`summary exceeds ${LIMITS.summary} chars`);
  const entries = normalizeEntries(args.entries);
  const tags = Array.isArray(args.tags) ? args.tags.slice(0, LIMITS.tags).map(t => String(t).slice(0, 32)) : [];
  const lineage = args.lineage && typeof args.lineage === 'object'
    ? { parent: args.lineage.parent ? String(args.lineage.parent).slice(0, 80) : null, generation: Number(args.lineage.generation) || null }
    : null;

  const c = args.consent && typeof args.consent === 'object' ? args.consent : {};
  const consent = { share: c.share !== false, derivatives: c.derivatives === true, anonymize: c.anonymize !== false };
  if (!consent.share) fail('consent.share is false: this pool only stores records meant to be shared');

  const body = { author, title, summary, entries, tags, lineage, consent };
  const byteLength = Buffer.byteLength(JSON.stringify(body));
  if (byteLength > LIMITS.body) fail(`dream exceeds ${LIMITS.body} bytes`);
  return { body, byteLength };
}
