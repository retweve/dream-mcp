/**
 * RFC 8785 JSON Canonicalization Scheme (JCS)。
 * 哈希与签名的唯一入口：任何"内容相同但键序不同"的 JSON 必须产生同一字节串。
 *
 * 约束（见 evo/sources/g1-rfc-prerequisites.md §2）：
 *   - 输入必须是 I-JSON：无重复键、数字为 IEEE-754 double、无孤立代理
 *   - 不输出空白
 *   - 字符串/数字按 ECMAScript 序列化（复用 JSON.stringify）
 *   - 对象键递归排序，按 UTF-16 code unit（JS 默认 sort 即此语义）
 *   - 输出 UTF-8
 */
import crypto from 'node:crypto';

export class JcsError extends Error {}

function assertIJson(seen) {
  // 用 WeakSet 只检测循环引用；重复键在 JSON.parse 阶段已丢失，入口需自行拒绝
  if (seen.has(arguments[1])) throw new JcsError('circular reference');
}

/** 规范化任意 JSON 值，返回字符串。 */
export function canonicalize(value) {
  const stack = new Set();
  let out = '';

  function ser(v) {
    if (v === null || typeof v === 'boolean') {
      out += JSON.stringify(v);
      return;
    }
    if (typeof v === 'string') {
      assertWellFormed(v); // RFC 8785 §3.2.2.2：孤立代理必须报错
      out += JSON.stringify(v);
      return;
    }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new JcsError('NaN/Infinity are not valid JSON numbers');
      // JSON.stringify(number) 与 ECMAScript Number::toString 一致（RFC 8785 §3.2.2.3）
      out += JSON.stringify(v);
      return;
    }
    if (typeof v !== 'object') throw new JcsError(`unsupported type: ${typeof v}`);
    if (stack.has(v)) throw new JcsError('circular reference');

    if (Array.isArray(v)) {
      stack.add(v);
      out += '[';
      for (let i = 0; i < v.length; i++) {
        if (i) out += ',';
        if (v[i] === undefined) throw new JcsError('undefined is not valid JSON');
        ser(v[i]);
      }
      out += ']';
      stack.delete(v);
      return;
    }

    stack.add(v);
    out += '{';
    const keys = Object.keys(v).sort(); // UTF-16 code unit 序
    let first = true;
    for (const k of keys) {
      if (v[k] === undefined) continue; // 与 JSON.stringify 一致：undefined 属性被省略
      if (!first) out += ',';
      first = false;
      // 孤立代理检测：JSON.stringify 会输出 \udXXX 但 RFC 8785 要求报错
      assertWellFormed(k);
      out += JSON.stringify(k) + ':';
      ser(v[k]);
    }
    out += '}';
    stack.delete(v);
  }

  ser(value);
  return out;
}

/** 拒绝孤立代理（RFC 8785 §3.2.2.2）。 */
function assertWellFormed(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) throw new JcsError('lone surrogate in string');
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      throw new JcsError('lone surrogate in string');
    }
  }
}

/** 规范化 → UTF-8 Buffer。 */
export function canonicalBytes(value) {
  return Buffer.from(canonicalize(value), 'utf8');
}

/** sha256(hex) of canonical bytes. */
export function contentHash(value) {
  return crypto.createHash('sha256').update(canonicalBytes(value)).digest('hex');
}
