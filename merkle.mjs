/**
 * RFC 6962 Merkle 哈希树（域分隔：叶 0x00 / 节点 0x01）。
 *
 * - `mth` / `auditPath`：服务端用（有完整叶子）
 * - `verifyInclusion`：**轻客户端**用（只需 index + size + 叶数据 + 路径 + 根，不需要其它叶子）
 * - `consistencyProof` / `verifyConsistency`：append-only 证明。当前 verifyConsistency 需要完整叶子序列
 *   （服务端审计用）；轻客户端版留待 G2——已在 evo/sources/g1-rfc-prerequisites.md 登记。
 *
 * 注意：audit path 是 inner-first，验证必须按递归结构从"最后一段"开始收，
 * 不能按数组顺序线性回放（线性回放会错判左右子树）。
 */
import crypto from 'node:crypto';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

export function leafHash(data) {
  return sha256(Buffer.concat([LEAF_PREFIX, data]));
}

export function nodeHash(left, right) {
  return sha256(Buffer.concat([NODE_PREFIX, left, right]));
}

export function isEmptyRoot(root) {
  return root.equals(sha256(Buffer.alloc(0)));
}

/** Merkle Tree Hash，RFC 6962 §2.1。leaves 是叶数据（Buffer）数组。 */
export function mth(leaves) {
  if (!Array.isArray(leaves)) throw new TypeError('leaves must be an array');
  if (leaves.length === 0) return sha256(Buffer.alloc(0));
  if (leaves.length === 1) return leafHash(leaves[0]);
  let k = 1;
  while (k * 2 < leaves.length) k *= 2;
  return nodeHash(mth(leaves.slice(0, k)), mth(leaves.slice(k)));
}

/** 生成 audit path（inner-first），服务端用。 */
export function auditPath(index, leaves) {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) throw new Error('index out of range');
  if (leaves.length === 1) return [];
  let k = 1;
  while (k * 2 < leaves.length) k *= 2;
  if (index < k) return [...auditPath(index, leaves.slice(0, k)), mth(leaves.slice(k))];
  return [...auditPath(index - k, leaves.slice(k)), mth(leaves.slice(0, k))];
}

/**
 * 轻客户端验证 inclusion proof。
 * @param {number} index 叶下标（0-based）
 * @param {number} size 树大小（叶数）
 * @param {Buffer} leafData 该叶的原始数据
 * @param {Buffer[]} path audit path（inner-first）
 * @param {Buffer} root 期望的根
 */
export function verifyInclusion(index, size, leafData, path, root) {
  if (!Number.isInteger(index) || index < 0 || index >= size) return false;
  const rec = (idx, n, nodes) => {
    if (n === 1) {
      if (nodes.length !== 0) throw new Error('path too long');
      return leafHash(leafData);
    }
    let k = 1;
    while (k * 2 < n) k *= 2;
    if (!nodes.length) throw new Error('path too short');
    const top = nodes[nodes.length - 1];
    const inner = nodes.slice(0, -1);
    return idx < k ? nodeHash(rec(idx, k, inner), top) : nodeHash(top, rec(idx - k, n - k, inner));
  };
  try {
    return rec(index, size, path).equals(root);
  } catch {
    return false;
  }
}

/** 一致性证明，RFC 6962 §2.1.2：证明前 m 叶是当前 n 叶的前缀。 */
export function consistencyProof(m, leaves) {
  const n = leaves.length;
  if (!Number.isInteger(m) || m <= 0 || m >= n) throw new Error('0 < m < n required');
  const sub = (mm, lv, known) => {
    if (mm === lv.length) return known ? [] : [mth(lv)];
    let k = 1;
    while (k * 2 < lv.length) k *= 2;
    if (mm <= k) return [...sub(mm, lv.slice(0, k), known), mth(lv.slice(k))];
    return [...sub(mm - k, lv.slice(k), false), mth(lv.slice(0, k))];
  };
  return sub(m, leaves, true);
}

/**
 * 服务端审计用：校验一致性证明结构，并验证两个根与前 m 叶/全部叶一致。
 * 轻客户端版（只给 oldRoot/newRoot/proof）未实现，登记在 G2。
 */
export function verifyConsistency(m, leaves, oldRoot, newRoot, proof) {
  const n = leaves.length;
  if (m < 0 || m > n) return false;
  if (m === 0) return isEmptyRoot(oldRoot) && proof.length === 0;
  if (m === n) return proof.length === 0 && oldRoot.equals(newRoot) && newRoot.equals(mth(leaves));
  if (!oldRoot.equals(mth(leaves.slice(0, m)))) return false;
  if (!newRoot.equals(mth(leaves))) return false;
  const expected = consistencyProof(m, leaves);
  if (expected.length !== proof.length) return false;
  return expected.every((b, i) => b.equals(proof[i]));
}
